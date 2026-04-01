/**
 * AbortHierarchy — WeakRef-based hierarchical abort controllers.
 *
 * Parent abort cascades to all children. Child abort is isolated (does not
 * propagate upward). WeakRef references prevent parent from keeping
 * abandoned children alive in memory.
 *
 * Inspired by claude-code's abort controller hierarchy pattern.
 */

export interface HierarchicalAbortController {
  /** The underlying AbortController. */
  controller: AbortController;
  /** The signal consumers should listen to. */
  signal: AbortSignal;
  /** Descriptive label for debugging/logging. */
  label: string;
  /** Create a child controller whose abort is isolated but inherits parent abort. */
  fork(childLabel?: string): HierarchicalAbortController;
  /** Abort this controller and all children. */
  abort(reason?: string): void;
  /** Whether this controller has been aborted. */
  readonly aborted: boolean;
}

/**
 * Create a root abort controller — the top of a hierarchy.
 */
export function createRootAbortController(
  label = "root",
): HierarchicalAbortController {
  return createController(label, null);
}

function createController(
  label: string,
  parent: HierarchicalAbortController | null,
): HierarchicalAbortController {
  const controller = new AbortController();
  const children: WeakRef<HierarchicalAbortController>[] = [];

  const self: HierarchicalAbortController = {
    controller,
    signal: controller.signal,
    label,

    get aborted() {
      return controller.signal.aborted;
    },

    fork(childLabel?: string): HierarchicalAbortController {
      const resolvedLabel = childLabel
        ? `${label}/${childLabel}`
        : `${label}/child`;
      const child = createController(resolvedLabel, self);

      // Store WeakRef to child (allows GC of abandoned children)
      const weakChild = new WeakRef(child);
      children.push(weakChild);

      // Subscribe child to parent's abort signal
      const handler = () => {
        const c = weakChild.deref();
        if (c && !c.aborted) {
          c.abort(controller.signal.reason as string | undefined);
        }
      };

      controller.signal.addEventListener("abort", handler, { once: true });

      // Auto-cleanup: remove parent listener when child aborts independently
      child.signal.addEventListener(
        "abort",
        () => {
          controller.signal.removeEventListener("abort", handler);
        },
        { once: true },
      );

      return child;
    },

    abort(reason?: string): void {
      if (controller.signal.aborted) return;
      controller.abort(reason);
    },
  };

  // If parent exists, subscribe this controller to parent's abort
  if (parent) {
    const weakSelf = new WeakRef(self);
    const parentHandler = () => {
      const s = weakSelf.deref();
      if (s && !s.aborted) {
        s.abort(parent.signal.reason as string | undefined);
      }
    };

    parent.signal.addEventListener("abort", parentHandler, { once: true });

    self.signal.addEventListener(
      "abort",
      () => {
        parent.signal.removeEventListener("abort", parentHandler);
      },
      { once: true },
    );
  }

  return self;
}
