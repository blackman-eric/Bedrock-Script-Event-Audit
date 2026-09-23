import { world } from "@minecraft/server";

const PREFIX = "[MCPE-174388-REPRO]";

// One ordinary living entity is included as a control. The remaining entries
// are the affected entity types verified during the broader event audit.
const TARGET_TYPES = new Set([
    "minecraft:cow",
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

function safe(fn, fallback = "<unavailable>") {
    try {
        const value = fn();
        return value ?? fallback;
    } catch {
        return fallback;
    }
}

function entityType(entity) {
    return safe(() => entity.typeId);
}

function entityId(entity) {
    return safe(() => entity.id);
}

function isTarget(entity) {
    return TARGET_TYPES.has(entityType(entity));
}

function damagingPlayer(damageSource) {
    const entity = safe(() => damageSource.damagingEntity, undefined);
    return entityType(entity) === "minecraft:player" ? entity : undefined;
}

function emit(eventName, fields = {}) {
    const details = Object.entries(fields)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(" | ");
    console.warn(`${PREFIX} event=${eventName}${details ? ` | ${details}` : ""}`);
}

function targetFields(entity) {
    return {
        targetType: entityType(entity),
        targetId: entityId(entity)
    };
}

// CONTROL / PRIMARY EVENT UNDER TEST -----------------------------------------
// For an ordinary living entity such as a cow, this fires before player attack
// damage and exposes a cancellable event. For the affected non-living targets,
// the event is absent.
world.beforeEvents.entityHurt.subscribe(event => {
    const player = damagingPlayer(event.damageSource);
    if (!player || !isTarget(event.hurtEntity))
        return;

    emit("BEFORE_ENTITY_HURT", {
        player: safe(() => player.name),
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
        player: safe(() => player.name),
        ...targetFields(event.hurtEntity),
        cause: safe(() => event.damageSource.cause),
        damage: safe(() => event.damage)
    });
});

// Confirms that a player hit many of the affected targets even though the
// EntityHurt before/after event family is missing for that same attack path.
world.afterEvents.entityHitEntity.subscribe(event => {
    if (entityType(event.damagingEntity) !== "minecraft:player" || !isTarget(event.hitEntity))
        return;

    emit("AFTER_HIT_ENTITY", {
        player: safe(() => event.damagingEntity.name),
        ...targetFields(event.hitEntity)
    });
});

// Useful control when the living entity is killed. A normal living entity can
// later be removed too; removal itself is NOT the bug being demonstrated.
world.afterEvents.entityDie.subscribe(event => {
    const player = damagingPlayer(event.damageSource);
    if (!player || !isTarget(event.deadEntity))
        return;

    emit("AFTER_ENTITY_DIE", {
        player: safe(() => player.name),
        ...targetFields(event.deadEntity),
        cause: safe(() => event.damageSource.cause)
    });
});

// Destruction/removal is observable for affected targets, but this before-event
// does not expose a cancel property. This is logged only to show that it cannot
// replace the missing cancellable EntityHurtBeforeEvent.
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
    api: "@minecraft/server 2.10.0",
    observationOnly: true
});
