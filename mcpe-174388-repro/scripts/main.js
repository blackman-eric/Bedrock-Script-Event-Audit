import { system, world } from "@minecraft/server";

const PREFIX = "[MCPE-174388-REPRO]";
let sequence = 0;

const CONTROL_TYPES = new Set([
    "minecraft:cow"
]);

const AFFECTED_TYPES = new Set([
    "minecraft:minecart",
    "minecraft:hopper_minecart",
    "minecraft:chest_minecart",
    "minecraft:tnt_minecart",
    "minecraft:command_block_minecart",
    "minecraft:boat",
    "minecraft:chest_boat",
    "minecraft:armor_stand",
    "minecraft:painting"
]);

const TARGET_TYPES = new Set([
    ...CONTROL_TYPES,
    ...AFFECTED_TYPES
]);

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

function entityType(entity) {
    return safe(() => entity?.typeId);
}

function entityId(entity) {
    return safe(() => entity?.id);
}

function itemType(itemStack) {
    return safe(() => itemStack?.typeId, "<empty>");
}

function isTarget(entity) {
    return TARGET_TYPES.has(entityType(entity));
}

function damagingPlayer(damageSource) {
    const entity = safe(() => damageSource?.damagingEntity, undefined);
    return entityType(entity) === "minecraft:player" ? entity : undefined;
}

function targetFields(entity) {
    return {
        targetType: entityType(entity),
        targetId: entityId(entity)
    };
}

function playerFields(player) {
    return {
        player: safe(() => player?.name),
        mode: safe(() => player?.getGameMode()),
        heldItem: safe(() => {
            const inv = player.getComponent("minecraft:inventory");
            return inv?.container?.getItem(player.selectedSlotIndex)?.typeId ?? "<empty>";
        }, "<empty>")
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
    return {
        viewTargetType: entityType(hit.entity),
        viewTargetId: entityId(hit.entity),
        viewTargetDistance: safe(() => Number(hit.distance).toFixed(3))
    };
}

function emit(eventName, fields = {}) {
    sequence++;
    const record = {
        seq: sequence,
        tick: safe(() => system.currentTick, -1),
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

// This is deliberately included for the Creative one-hit case. playerSwingStart
// is an after-event, but it gives a useful timing record around instant removal.
// We log every attack swing so the record is still useful if the target has
// already disappeared before the raycast is evaluated.
world.afterEvents.playerSwingStart.subscribe(event => {
    if (!String(event.swingSource).toLowerCase().includes("attack"))
        return;

    emit("PLAYER_SWING_START", {
        ...playerFields(event.player),
        swingHeldItem: itemType(event.heldItemStack),
        ...nearestViewEntity(event.player)
    });
});

// Primary event under test. Ordinary living entities such as a Cow expose this
// cancellable before-event for player attack damage. The affected non-living
// targets do not.
world.beforeEvents.entityHurt.subscribe(event => {
    const player = damagingPlayer(event.damageSource);
    if (!player || !isTarget(event.hurtEntity))
        return;

    emit("BEFORE_ENTITY_HURT", {
        ...playerFields(player),
        ...targetFields(event.hurtEntity),
        cause: safe(() => event.damageSource.cause),
        damage: safe(() => event.damage),
        hasCancelProperty: safe(() => "cancel" in event, false),
        cancelValue: safe(() => event.cancel, "<not-present>")
    });
});

world.afterEvents.entityHurt.subscribe(event => {
    const player = damagingPlayer(event.damageSource);
    if (!player || !isTarget(event.hurtEntity))
        return;

    emit("AFTER_ENTITY_HURT", {
        ...playerFields(player),
        ...targetFields(event.hurtEntity),
        cause: safe(() => event.damageSource.cause),
        damage: safe(() => event.damage)
    });
});

// In Survival, this often confirms that the player did hit the affected entity
// even though the EntityHurt family is absent. In Creative instant-destruction
// cases, this after-event may not be observed before the entity is removed.
world.afterEvents.entityHitEntity.subscribe(event => {
    if (entityType(event.damagingEntity) !== "minecraft:player" || !isTarget(event.hitEntity))
        return;

    emit("AFTER_HIT_ENTITY", {
        ...playerFields(event.damagingEntity),
        ...targetFields(event.hitEntity)
    });
});

// Living-entity control only. A living entity can later be removed too; removal
// itself is not the distinction under test.
world.afterEvents.entityDie.subscribe(event => {
    const player = damagingPlayer(event.damageSource);
    if (!player || !CONTROL_TYPES.has(entityType(event.deadEntity)))
        return;

    emit("AFTER_ENTITY_DIE", {
        ...playerFields(player),
        ...targetFields(event.deadEntity),
        cause: safe(() => event.damageSource.cause)
    });
});

// This is the only before-event observed on the affected entities' final
// destruction path. It exposes no cancel property, so it cannot substitute for
// the missing EntityHurtBeforeEvent.
world.beforeEvents.entityRemove.subscribe(event => {
    if (!isTarget(event.removedEntity))
        return;

    emit("BEFORE_ENTITY_REMOVE", {
        ...targetFields(event.removedEntity),
        hasCancelProperty: safe(() => "cancel" in event, false),
        cancelValue: safe(() => event.cancel, "<not-present>")
    });
});

world.afterEvents.entityRemove.subscribe(event => {
    const typeId = safe(() => event.typeId);
    if (!TARGET_TYPES.has(typeId))
        return;

    emit("AFTER_ENTITY_REMOVE", {
        targetType: typeId,
        targetId: safe(() => event.removedEntityId)
    });
});

emit("REPRO_LOADED", {
    version: "1.0.0",
    api: "@minecraft/server 2.10.0",
    observationOnly: true
});
