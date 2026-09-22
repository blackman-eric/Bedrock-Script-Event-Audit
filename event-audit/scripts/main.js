import {
    InputButton,
    system,
    world
} from "@minecraft/server";

const PREFIX = "[EVENT-AUDIT]";
const VERSION = "0.1.0";

let sequence = 0;
let activeMarker = "<none>";

const recentlyObserved = new Map();
const recentAttackSwing = new Map();

function safe(fn, fallback = "<unavailable>") {
    try {
        const value = fn();
        return value ?? fallback;
    } catch {
        return fallback;
    }
}

function clean(value) {
    return String(value ?? "<none>")
        .replaceAll("\n", "\\n")
        .replaceAll("\r", "\\r")
        .replaceAll("|", "/");
}

function nowTick() {
    return safe(() => system.currentTick, -1);
}

function pos(location) {
    if (!location)
        return "<none>";
    return `${Number(location.x).toFixed(2)},${Number(location.y).toFixed(2)},${Number(location.z).toFixed(2)}`;
}

function entityId(entity) {
    return safe(() => entity.id);
}

function entityType(entity) {
    return safe(() => entity.typeId);
}

function itemType(itemStack) {
    return safe(() => itemStack?.typeId, "<empty>");
}

function rememberEntity(entity) {
    const id = entityId(entity);
    if (!id || id === "<none>" || id === "<unavailable>")
        return;
    recentlyObserved.set(id, nowTick());
}

function playerContext(player) {
    return {
        player: safe(() => player?.name),
        playerId: entityId(player),
        mode: safe(() => player?.getGameMode()),
        sneak: safe(() => player?.inputInfo.getButtonState(InputButton.Sneak)),
        inputMode: safe(() => player?.inputInfo.lastInputModeUsed),
        platform: safe(() => player?.clientSystemInfo.platformType)
    };
}

function entityContext(entity) {
    const typeId = entityType(entity);

    let isChested = "<n/a>";
    if (["minecraft:donkey", "minecraft:mule", "minecraft:llama", "minecraft:trader_llama"].includes(typeId))
        isChested = safe(() => entity.hasComponent("minecraft:is_chested"));

    let containerType = "<none>";
    let containerSize = "<none>";
    const inventory = safe(() => entity?.getComponent("minecraft:inventory"), undefined);
    if (inventory && inventory !== "<unavailable>") {
        containerType = safe(() => inventory.containerType);
        containerSize = safe(() => inventory.container?.size);
    }

    return {
        targetType: typeId,
        targetId: entityId(entity),
        targetPos: pos(safe(() => entity?.location, undefined)),
        targetDim: safe(() => entity?.dimension.id),
        chested: isChested,
        containerType,
        containerSize
    };
}

function blockContext(block) {
    return {
        blockType: safe(() => block?.typeId),
        blockPos: pos(safe(() => block?.location, undefined)),
        blockDim: safe(() => block?.dimension.id)
    };
}

function emit(eventName, fields = {}) {
    sequence++;
    const record = {
        seq: sequence,
        tick: nowTick(),
        marker: activeMarker,
        event: eventName,
        ...fields
    };

    console.warn(
        `${PREFIX} ` +
        Object.entries(record)
            .map(([key, value]) => `${key}=${clean(value)}`)
            .join(" | ")
    );
}

function emitPlayer(eventName, player, fields = {}) {
    emit(eventName, {
        ...playerContext(player),
        ...fields
    });
}

function damagingPlayer(damageSource) {
    const damagingEntity = safe(() => damageSource?.damagingEntity, undefined);
    return entityType(damagingEntity) === "minecraft:player" ? damagingEntity : undefined;
}

function accessSourceEntity(source) {
    return safe(() => source?.entity, undefined);
}

function accessSourceContext(source) {
    const entity = accessSourceEntity(source);
    return {
        accessSourceType: entityType(entity),
        accessSourceId: entityId(entity),
        accessSourceName: safe(() => entity?.name, "<none>")
    };
}

function nearestViewEntity(player) {
    const hits = safe(() => player.getEntitiesFromViewDirection({
        maxDistance: 8,
        ignoreBlockCollision: false,
        includeLiquidBlocks: false,
        includePassableBlocks: false
    }), []);

    if (!Array.isArray(hits) || hits.length === 0) {
        return {
            viewTargetType: "<none>",
            viewTargetId: "<none>",
            viewTargetDistance: "<none>"
        };
    }

    const hit = hits[0];
    rememberEntity(hit.entity);

    return {
        viewTargetType: entityType(hit.entity),
        viewTargetId: entityId(hit.entity),
        viewTargetDistance: safe(() => Number(hit.distance).toFixed(3))
    };
}

function genericBeforeContext(event) {
    const player = safe(() => event.player, undefined);
    const source = safe(() => event.source, undefined);
    const sourcePlayer = entityType(source) === "minecraft:player" ? source : undefined;

    const entity =
        safe(() => event.target, undefined) ??
        safe(() => event.hurtEntity, undefined) ??
        safe(() => event.removedEntity, undefined) ??
        safe(() => event.entity, undefined);

    const block = safe(() => event.block, undefined);
    const item =
        safe(() => event.itemStack, undefined) ??
        safe(() => event.item, undefined);

    if (entity)
        rememberEntity(entity);

    return {
        ...(player || sourcePlayer ? playerContext(player ?? sourcePlayer) : {}),
        ...(entity ? entityContext(entity) : {}),
        ...(block ? blockContext(block) : {}),
        item: itemType(item),
        hasCancelProperty: safe(() => "cancel" in event, false),
        cancelValue: safe(() => event.cancel, "<not-present>")
    };
}

function isNearRecentAttack(entity) {
    const now = nowTick();
    const location = safe(() => entity.location, undefined);
    const dimension = safe(() => entity.dimension.id, undefined);
    if (!location || !dimension)
        return false;

    for (const data of recentAttackSwing.values()) {
        if (now - data.tick > 5 || data.dimension !== dimension)
            continue;

        const dx = location.x - data.location.x;
        const dy = location.y - data.location.y;
        const dz = location.z - data.location.z;
        if (dx * dx + dy * dy + dz * dz <= 64)
            return true;
    }

    return false;
}

function impactedBlockCount(event) {
    const blocks = safe(() => event.getImpactedBlocks(), []);
    return Array.isArray(blocks) ? blocks.length : "<unavailable>";
}


// -----------------------------------------------------------------------------
// RUNTIME EVENT-SURFACE CENSUS / FALLBACK SUBSCRIPTIONS
//
// Documentation can lag or differ by runtime build. To avoid silently missing
// a signal that exists in the actual game runtime, the probe enumerates the
// event-signal properties exposed by world.beforeEvents, world.afterEvents,
// system.beforeEvents, and system.afterEvents.
//
// Known events are handled by the detailed subscriptions below. Any additional
// WORLD before/after signal discovered at runtime is subscribed generically.
// This makes the audit self-checking if the runtime exposes something we did
// not explicitly anticipate.
// -----------------------------------------------------------------------------

function collectPropertyNames(object) {
    const names = new Set();
    let current = object;

    while (current && current !== Object.prototype) {
        for (const name of Object.getOwnPropertyNames(current))
            names.add(name);
        current = Object.getPrototypeOf(current);
    }

    names.delete("constructor");
    return [...names].sort();
}

function eventSignalNames(surface) {
    return collectPropertyNames(surface).filter(name => {
        try {
            return typeof surface[name]?.subscribe === "function";
        } catch {
            return false;
        }
    });
}

function eventPayloadKeys(event) {
    return collectPropertyNames(event)
        .filter(name => !["constructor"].includes(name))
        .join(",");
}

function genericEventContext(event) {
    const base = genericBeforeContext(event);

    const damagingEntity = safe(() => event.damageSource?.damagingEntity, undefined);
    const deadEntity = safe(() => event.deadEntity, undefined);
    const hitEntity = safe(() => event.hitEntity, undefined);
    const source = safe(() => event.source, undefined);

    return {
        ...base,
        payloadKeys: eventPayloadKeys(event),
        damagingEntityType: entityType(damagingEntity),
        damagingEntityId: entityId(damagingEntity),
        deadEntityType: entityType(deadEntity),
        deadEntityId: entityId(deadEntity),
        hitEntityType: entityType(hitEntity),
        hitEntityId: entityId(hitEntity),
        sourceType: entityType(source),
        sourceId: entityId(source)
    };
}

function logRuntimeEventSurfaces() {
    emit("RUNTIME_EVENT_SURFACE", {
        surface: "world.beforeEvents",
        signals: eventSignalNames(world.beforeEvents).join(",")
    });

    emit("RUNTIME_EVENT_SURFACE", {
        surface: "world.afterEvents",
        signals: eventSignalNames(world.afterEvents).join(",")
    });

    emit("RUNTIME_EVENT_SURFACE", {
        surface: "system.beforeEvents",
        signals: eventSignalNames(system.beforeEvents).join(",")
    });

    emit("RUNTIME_EVENT_SURFACE", {
        surface: "system.afterEvents",
        signals: eventSignalNames(system.afterEvents).join(",")
    });
}

const EXPLICIT_WORLD_BEFORE = new Set([
    "effectAdd",
    "entityHeal",
    "entityHurt",
    "entityItemPickup",
    "entityRemove",
    "explosion",
    "itemUse",
    "playerBreakBlock",
    "playerGameModeChange",
    "playerInteractWithBlock",
    "playerInteractWithEntity",
    "playerLeave",
    "weatherChange"
]);

const EXPLICIT_WORLD_AFTER = new Set([
    "playerSpawn",
    "playerGameModeChange",
    "playerInputModeChange",
    "playerButtonInput",
    "playerInteractWithEntity",
    "entityHurt",
    "entityHitEntity",
    "entityHitBlock",
    "playerSwingStart",
    "entityHealthChanged",
    "entityDie",
    "entityRemove",
    "playerInteractWithBlock",
    "playerBreakBlock",
    "playerStartBreakingBlock",
    "playerCancelBreakingBlock",
    "itemUse",
    "itemStartUse",
    "itemReleaseUse",
    "itemStopUse",
    "itemCompleteUse",
    "itemStartUseOn",
    "itemStopUseOn",
    "explosion",
    "blockExplode",
    "entityContainerOpened",
    "entityContainerClosed",
    "blockContainerOpened",
    "blockContainerClosed",
    "buttonPush",
    "leverAction",
    "projectileHitEntity",
    "projectileHitBlock"
]);

function subscribeGenericUnknownSignals(surfaceName, surface, explicitNames, prefix) {
    for (const name of eventSignalNames(surface)) {
        if (explicitNames.has(name))
            continue;

        try {
            surface[name].subscribe(event => {
                emit(`${prefix}_${name}`, genericEventContext(event));
            });

            emit("RUNTIME_FALLBACK_SUBSCRIBED", {
                surface: surfaceName,
                signal: name
            });
        } catch (error) {
            emit("RUNTIME_FALLBACK_SUBSCRIBE_FAILED", {
                surface: surfaceName,
                signal: name,
                error: safe(() => error.message, String(error))
            });
        }
    }
}

function pruneCaches() {
    const now = nowTick();

    for (const [id, seenTick] of recentlyObserved) {
        if (now - seenTick > 100)
            recentlyObserved.delete(id);
    }

    for (const [playerId, data] of recentAttackSwing) {
        if (now - data.tick > 10)
            recentAttackSwing.delete(playerId);
    }
}

// -----------------------------------------------------------------------------
// ALL STABLE @minecraft/server 2.9.0 WORLD BEFORE-EVENT SIGNALS
//
// The audit does NOT assume in advance which before-event is useful.
// Nothing is cancelled or mutated. Each event records whether a `cancel`
// property is actually exposed on the runtime event object.
// -----------------------------------------------------------------------------

world.beforeEvents.effectAdd.subscribe(event => {
    emit("BEFORE_EFFECT_ADD", {
        ...genericBeforeContext(event),
        effectType: safe(() => event.effect.typeId)
    });
});

world.beforeEvents.entityHeal.subscribe(event => {
    emit("BEFORE_ENTITY_HEAL", {
        ...genericBeforeContext(event),
        amount: safe(() => event.amount)
    });
});

world.beforeEvents.entityHurt.subscribe(event => {
    const player = damagingPlayer(event.damageSource);
    const entity = event.hurtEntity;
    rememberEntity(entity);

    emit(player ? "BEFORE_ENTITY_HURT_PLAYER_SOURCE" : "BEFORE_ENTITY_HURT", {
        ...(player ? playerContext(player) : {}),
        ...entityContext(entity),
        cause: safe(() => event.damageSource.cause),
        damage: safe(() => event.damage),
        projectileType: entityType(safe(() => event.damageSource.damagingProjectile, undefined)),
        hasCancelProperty: safe(() => "cancel" in event, false),
        cancelValue: safe(() => event.cancel, "<not-present>")
    });
});

world.beforeEvents.entityItemPickup.subscribe(event => {
    emit("BEFORE_ENTITY_ITEM_PICKUP", {
        ...genericBeforeContext(event)
    });
});

world.beforeEvents.entityRemove.subscribe(event => {
    const entity = event.removedEntity;
    const id = entityId(entity);

    // Keep removal noise manageable. Observed entities and entities removed
    // right next to a recent attack are retained.
    if (!recentlyObserved.has(id) && !isNearRecentAttack(entity))
        return;

    emit("BEFORE_ENTITY_REMOVE", {
        ...entityContext(entity),
        recentlyObserved: recentlyObserved.has(id),
        nearRecentAttack: isNearRecentAttack(entity),
        hasCancelProperty: safe(() => "cancel" in event, false),
        cancelValue: safe(() => event.cancel, "<not-present>")
    });
});

world.beforeEvents.explosion.subscribe(event => {
    emit("BEFORE_EXPLOSION", {
        sourceType: entityType(event.source),
        sourceId: entityId(event.source),
        dimension: safe(() => event.dimension.id),
        impactedBlocks: impactedBlockCount(event),
        hasCancelProperty: safe(() => "cancel" in event, false),
        cancelValue: safe(() => event.cancel, "<not-present>")
    });
});

world.beforeEvents.itemUse.subscribe(event => {
    emit("BEFORE_ITEM_USE", {
        ...genericBeforeContext(event),
        sourceType: entityType(event.source),
        sourceId: entityId(event.source)
    });
});

world.beforeEvents.playerBreakBlock.subscribe(event => {
    emitPlayer("BEFORE_BREAK_BLOCK", event.player, {
        ...blockContext(event.block),
        item: itemType(event.itemStack),
        hasCancelProperty: safe(() => "cancel" in event, false),
        cancelValue: safe(() => event.cancel, "<not-present>")
    });
});

world.beforeEvents.playerGameModeChange.subscribe(event => {
    emitPlayer("BEFORE_GAME_MODE_CHANGE", event.player, {
        fromMode: event.fromGameMode,
        toMode: event.toGameMode,
        hasCancelProperty: safe(() => "cancel" in event, false),
        cancelValue: safe(() => event.cancel, "<not-present>")
    });
});

world.beforeEvents.playerInteractWithBlock.subscribe(event => {
    emitPlayer("BEFORE_INTERACT_BLOCK", event.player, {
        ...blockContext(event.block),
        item: itemType(event.itemStack),
        face: safe(() => event.blockFace),
        firstEvent: safe(() => event.isFirstEvent),
        hasCancelProperty: safe(() => "cancel" in event, false),
        cancelValue: safe(() => event.cancel, "<not-present>")
    });
});

world.beforeEvents.playerInteractWithEntity.subscribe(event => {
    rememberEntity(event.target);
    emitPlayer("BEFORE_INTERACT_ENTITY", event.player, {
        ...entityContext(event.target),
        item: itemType(event.itemStack),
        hasCancelProperty: safe(() => "cancel" in event, false),
        cancelValue: safe(() => event.cancel, "<not-present>")
    });
});

world.beforeEvents.playerLeave.subscribe(event => {
    emit("BEFORE_PLAYER_LEAVE", {
        playerId: safe(() => event.playerId),
        playerName: safe(() => event.playerName),
        hasCancelProperty: safe(() => "cancel" in event, false),
        cancelValue: safe(() => event.cancel, "<not-present>")
    });
});

world.beforeEvents.weatherChange.subscribe(event => {
    emit("BEFORE_WEATHER_CHANGE", {
        dimension: safe(() => event.dimension.id),
        newWeather: safe(() => event.newWeather),
        previousWeather: safe(() => event.previousWeather),
        hasCancelProperty: safe(() => "cancel" in event, false),
        cancelValue: safe(() => event.cancel, "<not-present>")
    });
});

// -----------------------------------------------------------------------------
// SUPPORTING AFTER-EVENTS
// -----------------------------------------------------------------------------

world.afterEvents.playerSpawn.subscribe(event => {
    emitPlayer("PLAYER_SPAWN", event.player, {
        initialSpawn: event.initialSpawn
    });
});

world.afterEvents.playerGameModeChange.subscribe(event => {
    emitPlayer("AFTER_GAME_MODE_CHANGE", event.player, {
        fromMode: event.fromGameMode,
        toMode: event.toGameMode
    });
});

world.afterEvents.playerInputModeChange.subscribe(event => {
    emitPlayer("PLAYER_INPUT_MODE_CHANGE", event.player, {
        previousInputMode: safe(() => event.previousInputMode),
        newInputMode: safe(() => event.newInputMode)
    });
});

world.afterEvents.playerButtonInput.subscribe(event => {
    emitPlayer("SNEAK_BUTTON", event.player, {
        button: event.button,
        newState: event.newButtonState
    });
}, {
    buttons: [InputButton.Sneak]
});

world.afterEvents.playerInteractWithEntity.subscribe(event => {
    rememberEntity(event.target);
    emitPlayer("AFTER_INTERACT_ENTITY", event.player, {
        ...entityContext(event.target)
    });
});

world.afterEvents.entityHurt.subscribe(event => {
    const player = damagingPlayer(event.damageSource);
    const entity = event.hurtEntity;
    rememberEntity(entity);

    emit(player ? "AFTER_ENTITY_HURT_PLAYER_SOURCE" : "AFTER_ENTITY_HURT", {
        ...(player ? playerContext(player) : {}),
        ...entityContext(entity),
        cause: safe(() => event.damageSource.cause),
        damage: safe(() => event.damage),
        projectileType: entityType(safe(() => event.damageSource.damagingProjectile, undefined))
    });
});

world.afterEvents.entityHitEntity.subscribe(event => {
    const player = entityType(event.damagingEntity) === "minecraft:player"
        ? event.damagingEntity
        : undefined;

    rememberEntity(event.hitEntity);

    emit(player ? "AFTER_HIT_ENTITY_PLAYER_SOURCE" : "AFTER_HIT_ENTITY", {
        ...(player ? playerContext(player) : {}),
        attackerType: entityType(event.damagingEntity),
        attackerId: entityId(event.damagingEntity),
        ...entityContext(event.hitEntity)
    });
});

world.afterEvents.entityHitBlock.subscribe(event => {
    const player = entityType(event.damagingEntity) === "minecraft:player"
        ? event.damagingEntity
        : undefined;

    emit(player ? "AFTER_HIT_BLOCK_PLAYER_SOURCE" : "AFTER_HIT_BLOCK", {
        ...(player ? playerContext(player) : {}),
        attackerType: entityType(event.damagingEntity),
        attackerId: entityId(event.damagingEntity),
        ...blockContext(event.hitBlock)
    });
});

world.afterEvents.playerSwingStart.subscribe(event => {
    const player = event.player;
    const raycast = nearestViewEntity(player);

    emitPlayer("PLAYER_SWING_START", player, {
        swingSource: event.swingSource,
        heldItem: itemType(event.heldItemStack),
        ...raycast
    });

    if (String(event.swingSource).toLowerCase().includes("attack")) {
        recentAttackSwing.set(entityId(player), {
            tick: nowTick(),
            location: { ...safe(() => player.location, { x: 0, y: 0, z: 0 }) },
            dimension: safe(() => player.dimension.id)
        });
    }
});

world.afterEvents.entityHealthChanged.subscribe(event => {
    const id = entityId(event.entity);
    if (!recentlyObserved.has(id))
        return;

    emit("AFTER_ENTITY_HEALTH_CHANGED", {
        ...entityContext(event.entity),
        oldValue: event.oldValue,
        newValue: event.newValue
    });
});

world.afterEvents.entityDie.subscribe(event => {
    const player = damagingPlayer(event.damageSource);
    const id = entityId(event.deadEntity);

    if (!player && !recentlyObserved.has(id))
        return;

    rememberEntity(event.deadEntity);

    emit(player ? "AFTER_ENTITY_DIE_PLAYER_SOURCE" : "AFTER_ENTITY_DIE", {
        ...(player ? playerContext(player) : {}),
        ...entityContext(event.deadEntity),
        cause: safe(() => event.damageSource.cause)
    });
});

world.afterEvents.entityRemove.subscribe(event => {
    const id = safe(() => event.removedEntityId);
    if (!recentlyObserved.has(id))
        return;

    emit("AFTER_ENTITY_REMOVE", {
        targetType: safe(() => event.typeId),
        targetId: id
    });

    recentlyObserved.delete(id);
});

world.afterEvents.playerInteractWithBlock.subscribe(event => {
    emitPlayer("AFTER_INTERACT_BLOCK", event.player, {
        ...blockContext(event.block),
        item: itemType(event.itemStack),
        face: safe(() => event.blockFace)
    });
});

world.afterEvents.playerBreakBlock.subscribe(event => {
    emitPlayer("AFTER_BREAK_BLOCK", event.player, {
        brokenBlockType: safe(() => event.brokenBlockPermutation.type.id),
        blockPos: pos(safe(() => event.block.location, undefined)),
        blockDim: safe(() => event.block.dimension.id),
        itemBeforeBreak: itemType(safe(() => event.itemStackBeforeBreak, undefined)),
        itemAfterBreak: itemType(safe(() => event.itemStackAfterBreak, undefined))
    });
});

world.afterEvents.playerStartBreakingBlock.subscribe(event => {
    emitPlayer("START_BREAKING_BLOCK", event.player, {
        ...blockContext(event.block)
    });
});

world.afterEvents.playerCancelBreakingBlock.subscribe(event => {
    emitPlayer("CANCEL_BREAKING_BLOCK", event.player, {
        ...blockContext(event.block)
    });
});

world.afterEvents.itemUse.subscribe(event => {
    emit("AFTER_ITEM_USE", {
        ...genericBeforeContext(event),
        sourceType: entityType(event.source),
        sourceId: entityId(event.source)
    });
});

world.afterEvents.itemStartUse.subscribe(event => {
    emit("AFTER_ITEM_START_USE", {
        ...genericBeforeContext(event),
        sourceType: entityType(event.source),
        sourceId: entityId(event.source)
    });
});

world.afterEvents.itemReleaseUse.subscribe(event => {
    emit("AFTER_ITEM_RELEASE_USE", {
        ...genericBeforeContext(event),
        sourceType: entityType(event.source),
        sourceId: entityId(event.source)
    });
});

world.afterEvents.itemStopUse.subscribe(event => {
    emit("AFTER_ITEM_STOP_USE", {
        ...genericBeforeContext(event),
        sourceType: entityType(event.source),
        sourceId: entityId(event.source)
    });
});

world.afterEvents.itemCompleteUse.subscribe(event => {
    emit("AFTER_ITEM_COMPLETE_USE", {
        ...genericBeforeContext(event),
        sourceType: entityType(event.source),
        sourceId: entityId(event.source)
    });
});

world.afterEvents.itemStartUseOn.subscribe(event => {
    emit("AFTER_ITEM_START_USE_ON", {
        ...genericBeforeContext(event),
        ...blockContext(safe(() => event.block, undefined))
    });
});

world.afterEvents.itemStopUseOn.subscribe(event => {
    emit("AFTER_ITEM_STOP_USE_ON", {
        ...genericBeforeContext(event),
        ...blockContext(safe(() => event.block, undefined))
    });
});

world.afterEvents.explosion.subscribe(event => {
    emit("AFTER_EXPLOSION", {
        sourceType: entityType(event.source),
        sourceId: entityId(event.source),
        dimension: safe(() => event.dimension.id),
        impactedBlocks: impactedBlockCount(event)
    });
});

world.afterEvents.blockExplode.subscribe(event => {
    emit("AFTER_BLOCK_EXPLODE", {
        ...blockContext(event.block),
        sourceType: entityType(safe(() => event.source, undefined)),
        sourceId: entityId(safe(() => event.source, undefined))
    });
});

world.afterEvents.entityContainerOpened.subscribe(event => {
    rememberEntity(event.entity);
    const sourceEntity = accessSourceEntity(event.openSource);

    emit(entityType(sourceEntity) === "minecraft:player" ? "ENTITY_CONTAINER_OPENED_PLAYER_SOURCE" : "ENTITY_CONTAINER_OPENED", {
        ...(entityType(sourceEntity) === "minecraft:player" ? playerContext(sourceEntity) : {}),
        ...entityContext(event.entity),
        ...accessSourceContext(event.openSource)
    });
});

world.afterEvents.entityContainerClosed.subscribe(event => {
    rememberEntity(event.entity);
    const sourceEntity = accessSourceEntity(event.closeSource);

    emit(entityType(sourceEntity) === "minecraft:player" ? "ENTITY_CONTAINER_CLOSED_PLAYER_SOURCE" : "ENTITY_CONTAINER_CLOSED", {
        ...(entityType(sourceEntity) === "minecraft:player" ? playerContext(sourceEntity) : {}),
        ...entityContext(event.entity),
        ...accessSourceContext(event.closeSource)
    });
});

world.afterEvents.blockContainerOpened.subscribe(event => {
    const sourceEntity = accessSourceEntity(event.openSource);

    emit(entityType(sourceEntity) === "minecraft:player" ? "BLOCK_CONTAINER_OPENED_PLAYER_SOURCE" : "BLOCK_CONTAINER_OPENED", {
        ...(entityType(sourceEntity) === "minecraft:player" ? playerContext(sourceEntity) : {}),
        ...blockContext(event.block),
        ...accessSourceContext(event.openSource)
    });
});

world.afterEvents.blockContainerClosed.subscribe(event => {
    const sourceEntity = accessSourceEntity(event.closeSource);

    emit(entityType(sourceEntity) === "minecraft:player" ? "BLOCK_CONTAINER_CLOSED_PLAYER_SOURCE" : "BLOCK_CONTAINER_CLOSED", {
        ...(entityType(sourceEntity) === "minecraft:player" ? playerContext(sourceEntity) : {}),
        ...blockContext(event.block),
        ...accessSourceContext(event.closeSource)
    });
});

world.afterEvents.buttonPush.subscribe(event => {
    emit("AFTER_BUTTON_PUSH", {
        ...blockContext(safe(() => event.block, undefined)),
        sourceType: entityType(safe(() => event.source, undefined)),
        sourceId: entityId(safe(() => event.source, undefined))
    });
});

world.afterEvents.leverAction.subscribe(event => {
    emitPlayer("AFTER_LEVER_ACTION", safe(() => event.player, undefined), {
        ...blockContext(safe(() => event.block, undefined)),
        isPowered: safe(() => event.isPowered)
    });
});

world.afterEvents.projectileHitEntity.subscribe(event => {
    rememberEntity(safe(() => event.getEntityHit()?.entity, undefined));
    emit("AFTER_PROJECTILE_HIT_ENTITY", {
        projectileType: entityType(event.projectile),
        projectileId: entityId(event.projectile),
        sourceType: entityType(event.source),
        sourceId: entityId(event.source),
        hitType: entityType(safe(() => event.getEntityHit()?.entity, undefined)),
        hitId: entityId(safe(() => event.getEntityHit()?.entity, undefined))
    });
});

world.afterEvents.projectileHitBlock.subscribe(event => {
    emit("AFTER_PROJECTILE_HIT_BLOCK", {
        projectileType: entityType(event.projectile),
        projectileId: entityId(event.projectile),
        sourceType: entityType(event.source),
        sourceId: entityId(event.source),
        ...blockContext(safe(() => event.getBlockHit()?.block, undefined))
    });
});

// -----------------------------------------------------------------------------
// OPTIONAL MANUAL MARKERS
// /scriptevent event:audit <label>
// Marker persists onto later audit lines.
// -----------------------------------------------------------------------------

system.afterEvents.scriptEventReceive.subscribe(event => {
    if (event.id !== "event:audit")
        return;

    activeMarker = event.message || "<blank>";
    emit("MARKER_SET", {
        label: activeMarker,
        sourceType: event.sourceType
    });
});

system.runInterval(pruneCaches, 20);

logRuntimeEventSurfaces();
subscribeGenericUnknownSignals(
    "world.beforeEvents",
    world.beforeEvents,
    EXPLICIT_WORLD_BEFORE,
    "UNEXPECTED_BEFORE"
);
subscribeGenericUnknownSignals(
    "world.afterEvents",
    world.afterEvents,
    EXPLICIT_WORLD_AFTER,
    "UNEXPECTED_AFTER"
);

emit("PROBE_LOADED", {
    version: VERSION,
    api: "@minecraft/server 2.9.0",
    apiTrack: "stable",
    observationOnly: true,
    allDocumentedStableWorldBeforeEventsSubscribed: true,
    runtimeUnknownWorldSignalsAutoSubscribed: true
});
