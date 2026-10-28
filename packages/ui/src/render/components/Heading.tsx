// Headings carry their slug id, an anchor link that appears on hover, and an
// optional section number when numbering is on.
import { createContext, useContext, type ReactNode, type ElementType } from 'react';
import { formatNumber } from '../number.js';

export const NumberingContext = createContext(false);

type Props = { id?: string; 'data-number'?: string; 'data-pos'?: string; children?: ReactNode };

export function heading(tag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6') {
  const Tag = tag as ElementType;
  return function Heading(props: Props) {
    const numbering = useContext(NumberingContext);
    const number = numbering ? props['data-number'] : undefined;
    return (
      <Tag
        id={props.id}
        className="leaf-heading"
        data-pos={props['data-pos']}
        data-number={props['data-number']}
      >
        {props.id && (
          <a
            className="leaf-anchor"
            href={`#${props.id}`}
            aria-hidden="true"
            tabIndex={-1}
            title="Link to this heading"
          >
            #
          </a>
        )}
        {number && <span className="leaf-number">{formatNumber(number)} </span>}
        {props.children}
      </Tag>
    );
  };
}
