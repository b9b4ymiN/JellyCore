import type { HTMLAttributes, ReactNode } from 'react';
import styles from './Card.module.css';

interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  compact?: boolean;
  hoverable?: boolean;
}

export function Card({
  title,
  subtitle,
  actions,
  compact = false,
  hoverable = false,
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <section
      {...rest}
      className={[
        styles.card,
        compact ? styles.compact : '',
        hoverable ? styles.hoverable : '',
        className || '',
      ].join(' ').trim()}
    >
      {(title || subtitle || actions) && (
        <header className={styles.header}>
          <div>
            {title ? <h3 className={styles.title}>{title}</h3> : null}
            {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
          </div>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}
