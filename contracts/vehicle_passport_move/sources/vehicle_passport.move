module vehicle_passport_move::vehicle_passport;

use std::string::String;
use iota::event;

const E_NOT_ADMIN: u64 = 1;
const E_WORKSHOP_NOT_ACTIVE: u64 = 2;
const E_ODOMETER_ROLLBACK: u64 = 3;
const E_ZERO_VALUE: u64 = 4;
const E_UNAUTHORIZED_SENDER: u64 = 5;

public struct Registry has key {
    id: UID,
    admin: address,
    workshops: vector<WorkshopIdentity>,
    passport_counter: u64,
}

public struct WorkshopIdentity has store, drop {
    workshop: address,
    did: String,
    public_key_multibase: String,
    active: bool,
}

public struct VehiclePassport has key, store {
    id: UID,
    vin: String,
    make: String,
    model: String,
    year: u64,
    owner: address,
    latest_odometer_km: u64,
    intervention_counter: u64,
    interventions: vector<ServiceIntervention>,
}

public struct ServiceIntervention has store, drop {
    seq: u64,
    workshop: address,
    odometer_km: u64,
    work_type: String,
    notes_hash: String,
    evidence_uri: String,
    workshop_signature: String,
    recorded_at_ms: u64,
}

public struct RegistryCreated has copy, drop {
    admin: address,
}

public struct WorkshopRegistered has copy, drop {
    workshop: address,
}

public struct WorkshopStatusChanged has copy, drop {
    workshop: address,
    active: bool,
}

public struct PassportMinted has copy, drop {
    owner: address,
}

public struct InterventionRecorded has copy, drop {
    workshop: address,
    odometer_km: u64,
}

fun init(ctx: &mut TxContext) {
    let sender = tx_context::sender(ctx);
    let registry = Registry {
        id: object::new(ctx),
        admin: sender,
        workshops: vector::empty(),
        passport_counter: 0,
    };
    event::emit(RegistryCreated { admin: sender });
    transfer::share_object(registry);
}

public entry fun register_workshop(
    registry: &mut Registry,
    workshop: address,
    did: String,
    public_key_multibase: String,
    ctx: &mut TxContext,
) {
    assert!(workshop == tx_context::sender(ctx), E_UNAUTHORIZED_SENDER);
    vector::push_back(
        &mut registry.workshops,
        WorkshopIdentity {
            workshop,
            did,
            public_key_multibase,
            active: true,
        },
    );
    event::emit(WorkshopRegistered { workshop });
}

public entry fun set_workshop_status(
    registry: &mut Registry,
    workshop: address,
    active: bool,
    ctx: &mut TxContext,
) {
    assert_admin(registry, ctx);
    let idx = find_workshop_index(registry, workshop);
    let identity = vector::borrow_mut(&mut registry.workshops, idx);
    identity.active = active;
    event::emit(WorkshopStatusChanged { workshop, active });
}

public entry fun mint_vehicle_passport(
    registry: &mut Registry,
    vin: String,
    make: String,
    model: String,
    year: u64,
    owner: address,
    ctx: &mut TxContext,
) {
    assert!(owner == tx_context::sender(ctx), E_UNAUTHORIZED_SENDER);
    assert!(year > 0, E_ZERO_VALUE);

    let passport = VehiclePassport {
        id: object::new(ctx),
        vin,
        make,
        model,
        year,
        owner,
        latest_odometer_km: 0,
        intervention_counter: 0,
        interventions: vector::empty(),
    };

    registry.passport_counter = registry.passport_counter + 1;
    event::emit(PassportMinted { owner });
    transfer::public_transfer(passport, owner);
}

public entry fun record_intervention(
    registry: &Registry,
    passport: &mut VehiclePassport,
    odometer_km: u64,
    work_type: String,
    notes_hash: String,
    evidence_uri: String,
    workshop_signature: String,
    recorded_at_ms: u64,
    ctx: &mut TxContext,
) {
    assert!(is_workshop_active(registry, tx_context::sender(ctx)), E_WORKSHOP_NOT_ACTIVE);
    assert!(odometer_km >= passport.latest_odometer_km, E_ODOMETER_ROLLBACK);
    assert!(recorded_at_ms > 0, E_ZERO_VALUE);

    passport.intervention_counter = passport.intervention_counter + 1;
    passport.latest_odometer_km = odometer_km;

    vector::push_back(
        &mut passport.interventions,
        ServiceIntervention {
            seq: passport.intervention_counter,
            workshop: tx_context::sender(ctx),
            odometer_km,
            work_type,
            notes_hash,
            evidence_uri,
            workshop_signature,
            recorded_at_ms,
        },
    );

    event::emit(InterventionRecorded {
        workshop: tx_context::sender(ctx),
        odometer_km,
    });
}

public entry fun transfer_passport(
    passport: VehiclePassport,
    to: address,
) {
    let mut passport_mut = passport;
    passport_mut.owner = to;
    transfer::public_transfer(passport_mut, to);
}

public fun workshop_count(registry: &Registry): u64 {
    vector::length(&registry.workshops)
}

public fun intervention_count(passport: &VehiclePassport): u64 {
    vector::length(&passport.interventions)
}

fun is_workshop_active(registry: &Registry, workshop: address): bool {
    let len = vector::length(&registry.workshops);
    let mut i = 0;
    while (i < len) {
        let item = vector::borrow(&registry.workshops, i);
        if (item.workshop == workshop) {
            return item.active
        };
        i = i + 1;
    };
    false
}

fun find_workshop_index(registry: &Registry, workshop: address): u64 {
    let len = vector::length(&registry.workshops);
    let mut i = 0;
    while (i < len) {
        let item = vector::borrow(&registry.workshops, i);
        if (item.workshop == workshop) {
            return i
        };
        i = i + 1;
    };
    abort E_WORKSHOP_NOT_ACTIVE
}

fun assert_admin(registry: &Registry, ctx: &TxContext) {
    assert!(registry.admin == tx_context::sender(ctx), E_NOT_ADMIN);
}
