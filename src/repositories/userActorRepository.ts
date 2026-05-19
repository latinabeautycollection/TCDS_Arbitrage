import { ActorContext, ActorType } from '../types/common';
import { ValidationError } from '../lib/errors';

export interface ResolveActorInput {
  actorType?: ActorType | null;
  actorId?: string | null;
  actorName?: string | null;
  workerName?: string | null;
  workerInstanceId?: string | null;
}

export class UserActorRepository {
  private static readonly VALID_ACTOR_TYPES: ReadonlySet<ActorType> = new Set([
    'user',
    'worker',
    'system',
    'api',
    'service_account'
  ]);

  /**
   * Validate and normalize any incoming actor context into the canonical system shape.
   * This is the single place that should decide whether an actor payload is valid
   * enough to be written into the forensic control plane.
   */
  resolve(input: ResolveActorInput): ActorContext {
    const actorType = input.actorType ?? 'system';

    this.assertValidActorType(actorType);

    const normalized: ActorContext = {
      actorType,
      actorId: this.normalizeNullableString(input.actorId),
      actorName: this.normalizeNullableString(input.actorName),
      workerName: this.normalizeNullableString(input.workerName),
      workerInstanceId: this.normalizeNullableString(input.workerInstanceId)
    };

    this.assertActorShape(normalized);

    return normalized;
  }

  /**
   * Canonical worker actor builder.
   */
  buildWorkerActor(workerName: string, workerInstanceId?: string | null): ActorContext {
    const normalizedWorkerName = this.requireNonEmptyString(workerName, 'workerName');

    return this.resolve({
      actorType: 'worker',
      actorId: normalizedWorkerName,
      actorName: normalizedWorkerName,
      workerName: normalizedWorkerName,
      workerInstanceId
    });
  }

  /**
   * Canonical system actor builder.
   */
  buildSystemActor(actorId = 'system', actorName = 'system'): ActorContext {
    return this.resolve({
      actorType: 'system',
      actorId,
      actorName
    });
  }

  /**
   * Canonical API actor builder.
   */
  buildApiActor(actorId: string, actorName?: string | null): ActorContext {
    const normalizedActorId = this.requireNonEmptyString(actorId, 'actorId');

    return this.resolve({
      actorType: 'api',
      actorId: normalizedActorId,
      actorName: actorName ?? normalizedActorId
    });
  }

  /**
   * Canonical service account actor builder.
   */
  buildServiceAccountActor(actorId: string, actorName?: string | null): ActorContext {
    const normalizedActorId = this.requireNonEmptyString(actorId, 'actorId');

    return this.resolve({
      actorType: 'service_account',
      actorId: normalizedActorId,
      actorName: actorName ?? normalizedActorId
    });
  }

  /**
   * Canonical user actor builder.
   */
  buildUserActor(actorId: string, actorName?: string | null): ActorContext {
    const normalizedActorId = this.requireNonEmptyString(actorId, 'actorId');

    return this.resolve({
      actorType: 'user',
      actorId: normalizedActorId,
      actorName: actorName ?? normalizedActorId
    });
  }

  /**
   * Useful for policy logic and replay/certification gating.
   */
  isAutomatedActor(actor: ActorContext): boolean {
    return (
      actor.actorType === 'worker' ||
      actor.actorType === 'system' ||
      actor.actorType === 'api' ||
      actor.actorType === 'service_account'
    );
  }

  /**
   * Useful for override handling and dispute review logic.
   */
  isHumanActor(actor: ActorContext): boolean {
    return actor.actorType === 'user';
  }

  /**
   * Produce a safe DB-write payload for repositories that write actor fields.
   */
  toDbFields(actor: ActorContext) {
    return {
      actor_type: actor.actorType,
      actor_id: actor.actorId ?? null,
      actor_name: actor.actorName ?? null,
      worker_name: actor.workerName ?? null,
      worker_instance_id: actor.workerInstanceId ?? null
    };
  }

  private assertValidActorType(actorType: string): asserts actorType is ActorType {
    if (!UserActorRepository.VALID_ACTOR_TYPES.has(actorType as ActorType)) {
      throw new ValidationError(`Invalid actorType "${actorType}"`, {
        actorType,
        allowedValues: Array.from(UserActorRepository.VALID_ACTOR_TYPES)
      });
    }
  }

  private assertActorShape(actor: ActorContext): void {
    switch (actor.actorType) {
      case 'worker': {
        if (!actor.workerName) {
          throw new ValidationError('worker actor requires workerName', {
            actorType: actor.actorType
          });
        }

        if (!actor.actorId) {
          throw new ValidationError('worker actor requires actorId', {
            actorType: actor.actorType
          });
        }

        break;
      }

      case 'user':
      case 'api':
      case 'service_account': {
        if (!actor.actorId) {
          throw new ValidationError(`${actor.actorType} actor requires actorId`, {
            actorType: actor.actorType
          });
        }
        break;
      }

      case 'system': {
        if (!actor.actorId) {
          throw new ValidationError('system actor requires actorId', {
            actorType: actor.actorType
          });
        }
        break;
      }

      default: {
        const exhaustiveCheck: never = actor.actorType;
        throw new ValidationError('Unhandled actor type', {
          actorType: exhaustiveCheck
        });
      }
    }
  }

  private normalizeNullableString(value: string | null | undefined): string | null {
    if (value == null) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private requireNonEmptyString(value: string | null | undefined, fieldName: string): string {
    const normalized = this.normalizeNullableString(value);
    if (!normalized) {
      throw new ValidationError(`${fieldName} must be a non-empty string`, {
        fieldName
      });
    }
    return normalized;
  }
}
