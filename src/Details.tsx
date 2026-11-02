import { useEffect, useState } from 'react';
import { FactRow, Popover, type PopoverPlacement } from '@hearthscale/app-ui';
import { hostContext } from './bridge';
import { sizeOf } from './pictures';
import { STYLES } from './recipes';
import { getRun, nameOf, type Picture, type Run } from './records';

/** What a picture was made from, in the words of the prompt's own fields,
 *  in a popover beside the element it opens from. */
export function Details(props: {
  picture: Picture;
  anchor: HTMLElement;
  placement: PopoverPlacement;
  onDismiss: () => void;
}) {
  const { picture } = props;
  const [run, setRun] = useState<Run | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const locale = hostContext().locale ?? navigator.language;

  useEffect(() => {
    let current = true;
    void getRun(picture.run).then((found) => current && setRun(found));
    void sizeOf(picture.path).then((found) => current && setSize(found));
    return () => {
      current = false;
    };
  }, [picture.run, picture.path]);

  const style = run?.style ? STYLES.find((s) => s.id === run.style)?.label : undefined;
  const made = new Date(picture.made).toLocaleString(locale, { dateStyle: 'long', timeStyle: 'short' });
  return (
    <Popover anchor={props.anchor} placement={props.placement} label="Details" onDismiss={props.onDismiss}>
      <div className="is-details">
        {picture.prompt && <FactRow label="Prompt" value={nameOf(picture.prompt)} />}
        {style && <FactRow label="Style" value={style} />}
        {run?.negative && <FactRow label="Things to leave out" value={run.negative} />}
        {picture.label && <FactRow label="Model" value={picture.label} />}
        {size && <FactRow label="Size" value={`${size.width} × ${size.height}`} />}
        {run?.steps !== null && run?.steps !== undefined && <FactRow label="Detail" value={String(run.steps)} />}
        {run?.guidance !== null && run?.guidance !== undefined && (
          <FactRow label="Follow the words" value={String(run.guidance)} />
        )}
        {picture.seed !== null && <FactRow label="Picture number" value={String(picture.seed)} />}
        <FactRow label="Date" value={made} />
      </div>
    </Popover>
  );
}
