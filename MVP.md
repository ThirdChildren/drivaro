# IOTA Auto Passport - MVP Narrative

Used-car fraud is still a major trust problem: odometers are rolled back, maintenance history is edited, and buyers often make decisions with incomplete or manipulated data. Our MVP addresses this with a simple idea: every relevant service event should become a verifiable on-chain fact, not a paper promise.

IOTA Auto Passport creates a digital passport for each vehicle and appends certified interventions over time. A workshop onboards with its wallet identity, then records an intervention by attaching three critical proofs: a document hash, a wallet signature, and a timestamp. The result is a tamper-evident timeline that buyers can inspect by VIN before purchase.

This MVP focuses on three IOTA value pillars that are already live in the product. First, **tokenization**: the vehicle passport is a Move object that represents the durable on-chain identity of the car. Second, **digital identity**: workshops are represented by wallet address, DID, and public key, so each action is attributable to a real signer. Third, **notarization**: intervention evidence is hashed and signed, making retroactive edits detectable and economically costly.

IOTA adds value because it enables a shared trust layer across actors that normally do not trust each other: workshops, dealers, buyers, insurers, and fleets. Instead of syncing private databases and PDFs, they read the same state. This improves transparency today and creates a foundation for future services such as underwriting, residual-value scoring, and compliance reporting.

The near-term business model is pragmatic: a SaaS product for workshops/dealers (subscription + usage), plus verification APIs for marketplaces and insurers. Over time, this can evolve into a data network for automotive trust, where verified maintenance history becomes a standard asset in every resale and risk workflow.

In hackathon terms, this MVP is intentionally focused: onboard identity, mint passport, notarize intervention, verify history. It demonstrates real utility now, while clearly scaling toward a larger ecosystem opportunity.
