import type { ReactNode } from 'react';
import type { useFloatingTips } from '@hearthscale/app-ui';

type Tips = ReturnType<typeof useFloatingTips>;

/** A control with a tooltip that explains the app's word on it. */
export function explained(tips: Tips, key: string, text: string, control: ReactNode) {
  const tip = tips(key, text);
  return (
    <span key={key} {...tip.hover} className="is-tipwrap">
      {control}
      {tip.tip}
    </span>
  );
}
