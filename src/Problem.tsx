import { Icon, Notice, useFloatingTips } from '@hearthscale/app-ui';

/** Something that did not happen: one sentence the app writes, the words
 *  Hearthscale or its Server gave for it, and what tries it again. */
export interface Problem {
  text: string;
  detail: string | null;
  retry: (() => void) | null;
}

/** A problem as a notice: its sentence, its detail in a tooltip, and Try
 *  again where the app can repeat what failed, else Close. */
export function ProblemNotice(props: { problem: Problem; onClose?: () => void }) {
  const { text, detail, retry } = props.problem;
  const tips = useFloatingTips('top');
  const why = tips('why', detail && detail !== text ? detail : undefined);
  return (
    <Notice>
      <span {...why.hover} className="is-tipwrap is-problem-text">
        {text}
        {detail && detail !== text && <Icon name="information-line" size={14} className="is-problem-mark" />}
        {why.tip}
      </span>
      {retry ? (
        <button className="hs-link" onClick={retry}>
          Try again
        </button>
      ) : (
        <button className="hs-link" onClick={props.onClose}>
          Close
        </button>
      )}
    </Notice>
  );
}
