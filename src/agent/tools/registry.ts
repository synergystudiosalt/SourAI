import { SourError } from '../../contracts/errors';
import { READ_ONLY_TOOLS } from './readOnly';
import { MUTATION_TOOLS } from './mutationTools';
import type { AgentProfile, ToolDescriptor } from './types';

type AnyToolDescriptor = ToolDescriptor<any>;

export class ToolRegistry {
  private readonly descriptors = new Map<string, AnyToolDescriptor>();

  constructor(descriptors: readonly AnyToolDescriptor[] = DEFAULT_TOOL_DESCRIPTORS) {
    for (const descriptor of descriptors) {
      if (this.descriptors.has(descriptor.name)) {
        throw new TypeError(`Duplicate tool descriptor: ${descriptor.name}`);
      }
      this.descriptors.set(descriptor.name, descriptor);
    }
  }

  get(name: string): AnyToolDescriptor {
    const descriptor = this.descriptors.get(name);
    if (!descriptor) {
      throw new SourError({
        code: 'unknown_tool',
        message: 'The provider requested an unsupported tool.',
        causeCategory: 'validation',
        retryable: false,
        details: { name },
      });
    }
    return descriptor;
  }

  list(): readonly AnyToolDescriptor[] {
    return Object.freeze([...this.descriptors.values()]);
  }

  /**
   * Tools a profile may use.
   *
   * Ask and Plan are never shown a mutation tool, so the model is not invited
   * to attempt one; the policy check on execution remains the enforcement.
   */
  listForProfile(profile: AgentProfile): readonly AnyToolDescriptor[] {
    return Object.freeze(
      [...this.descriptors.values()].filter(
        (descriptor) => profile === 'write' || descriptor.risk === 'read'
      )
    );
  }

  isMutating(name: string): boolean {
    // An unknown name is treated as mutating so a typo or an injected tool
    // name cannot slip past the profile gate.
    try {
      return this.get(name).risk !== 'read';
    } catch {
      return true;
    }
  }
}

export const DEFAULT_TOOL_DESCRIPTORS: readonly AnyToolDescriptor[] = Object.freeze([
  ...READ_ONLY_TOOLS,
  ...MUTATION_TOOLS,
]);
