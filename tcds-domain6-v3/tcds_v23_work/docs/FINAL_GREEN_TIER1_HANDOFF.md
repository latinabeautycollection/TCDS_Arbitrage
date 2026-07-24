# Final Green Tier 1 Handoff Notes

## Purpose

This document locks the Domain 6 shell as the permanent visual/routing baseline for the Warehouse Execution PWA.

## Final Screen Philosophy

The application is intentionally lean. It is built around warehouse work, not around large menus or unnecessary pages.

Every employee should be able to move through the system with minimal instruction:

Login -> Dashboard -> Receive / Inventory / Pick / Pack & Ship / Returns / Exceptions

## Screen Creep Protection

Any future feature must first be evaluated against the approved 12 screens. If the feature can be handled with a bottom sheet, modal, expandable section, toast, or workflow state, a new screen is prohibited.

## Shell vs Business Logic

This package is the shell. It shows visual structure, route structure, screen responsibilities, motion-ready components, and state patterns. Backend business logic is intentionally deferred.

## Required Next Phase

After shell approval, the next package should implement:

1. PostgreSQL migrations
2. API contracts
3. Auth/session/device registration
4. Scandit SDK integration
5. Photo capture and object storage
6. Receiving workflow state machine
7. Inventory digital twin
8. Audit events
9. Offline sync
10. Domain 3 shipping handoff
11. Domain 4 listing queue handoff
