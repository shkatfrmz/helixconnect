import { ReactNode } from "react";

type Props = {
  title: string;
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
};

export default function Window({ title, children, className, actions }: Props) {
  return (
    <article className={`win ${className || ""}`}>
      <header className="win-bar">
        <span className="traffic" aria-hidden>
          <i className="c" />
          <i className="m" />
          <i className="x" />
        </span>
        <span className="win-title">{title}</span>
        {actions ? <div className="win-actions">{actions}</div> : null}
      </header>
      <div className="win-body">{children}</div>
    </article>
  );
}
