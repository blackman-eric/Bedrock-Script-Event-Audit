import { world } from "@minecraft/server";

const WATCHED_TYPES = new Set([
    "minecraft:donkey",
    "minecraft:mule",
    "minecraft:llama",
    "minecraft:trader_llama",
    "minecraft:chest_minecart",
    "minecraft:hopper_minecart",
    "minecraft:chest_boat",
    "minecraft:boat",
    "minecraft:minecart",
    "minecraft:armor_stand"
]);

function safeTypeId(entity) {
    try {
        return entity?.typeId ?? "<none>";
    } catch {
        return "<unavailable>";
    }
}

function isWatched(entity) {
    return WATCHED_TYPES.has(safeTypeId(entity));
}

function describeEntity(entity) {
    const typeId = safeTypeId(entity);
    let chested = "n/a";
    let containerType = "none";
    let containerSize = "none";

    try {
        if (["minecraft:donkey", "minecraft:mule", "minecraft:llama", "minecraft:trader_llama"].includes(typeId))
            chested = String(entity.hasComponent("minecraft:is_chested"));
    } catch {}

    try {
        const inventory = entity?.getComponent("minecraft:inventory");
        if (inventory) {
            containerType = inventory.containerType ?? "<unknown>";
            containerSize = inventory.container?.size ?? "<unavailable>";
        }
    } catch {}

    return `${typeId} chested=${chested} containerType=${containerType} containerSize=${containerSize}`;
}

function sourceIsPlayer(damageSource) {
    return safeTypeId(damageSource?.damagingEntity) === "minecraft:player";
}

function log(message) {
    console.warn(`[MCPE-174388] ${message}`);
}

log("probe loaded");

// Interaction path: these events are included to show that the same target entities
// are exposed normally through entity-interaction events.
world.beforeEvents.playerInteractWithEntity.subscribe(event => {
    if (!isWatched(event.target))
        return;

    log(`BEFORE playerInteractWithEntity | target=${describeEntity(event.target)} | player=${event.player.name}`);
});

world.afterEvents.playerInteractWithEntity.subscribe(event => {
    if (!isWatched(event.target))
        return;

    log(`AFTER playerInteractWithEntity | target=${describeEntity(event.target)} | player=${event.player.name}`);
});

// Damage path under test.
world.beforeEvents.entityHurt.subscribe(event => {
    if (!sourceIsPlayer(event.damageSource) || !isWatched(event.hurtEntity))
        return;

    log(
        `BEFORE entityHurt | target=${describeEntity(event.hurtEntity)} | ` +
        `source=${safeTypeId(event.damageSource.damagingEntity)} | ` +
        `cause=${event.damageSource.cause} | damage=${event.damage}`
    );
});

world.afterEvents.entityHurt.subscribe(event => {
    if (!sourceIsPlayer(event.damageSource) || !isWatched(event.hurtEntity))
        return;

    log(
        `AFTER entityHurt | target=${describeEntity(event.hurtEntity)} | ` +
        `source=${safeTypeId(event.damageSource.damagingEntity)} | ` +
        `cause=${event.damageSource.cause} | damage=${event.damage}`
    );
});

// These events show that the player's melee action is still visible even when
// entityHurt is absent for the affected non-living entities.
world.afterEvents.entityHitEntity.subscribe(event => {
    if (safeTypeId(event.damagingEntity) !== "minecraft:player" || !isWatched(event.hitEntity))
        return;

    log(
        `AFTER entityHitEntity | target=${describeEntity(event.hitEntity)} | ` +
        `source=${safeTypeId(event.damagingEntity)}`
    );
});

world.afterEvents.playerSwingStart.subscribe(event => {
    let held = "<empty>";
    try {
        held = event.heldItemStack?.typeId ?? "<empty>";
    } catch {}

    log(`AFTER playerSwingStart | player=${event.player.name} | held=${held} | source=${event.swingSource}`);
});

// Removal/death diagnostics. These do not replace a cancellable pre-damage event;
// they are logged only to show the lifecycle path when a target is destroyed.
world.beforeEvents.entityRemove.subscribe(event => {
    if (!isWatched(event.removedEntity))
        return;

    log(`BEFORE entityRemove | target=${describeEntity(event.removedEntity)}`);
});

world.afterEvents.entityRemove.subscribe(event => {
    if (!WATCHED_TYPES.has(event.typeId))
        return;

    log(`AFTER entityRemove | target=${event.typeId} | id=${event.removedEntityId}`);
});

world.afterEvents.entityDie.subscribe(event => {
    if (!isWatched(event.deadEntity))
        return;

    log(
        `AFTER entityDie | target=${describeEntity(event.deadEntity)} | ` +
        `source=${safeTypeId(event.damageSource?.damagingEntity)} | ` +
        `cause=${event.damageSource?.cause ?? "<none>"}`
    );
});
