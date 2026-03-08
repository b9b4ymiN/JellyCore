import type { HTMLAttributes, ReactNode } from 'react';
import styles from './Badge.module.css';

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'ghost';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  icon?: ReactNode;
}

export function Badge({
  variant = 'default',
  icon,
  children,
  className,
  ...rest
}: BadgeProps) {
  return (
    <span
      {...rest}
      className={[styles.badge, styles[variant], className || ''].join(' ').trim()}
    >
      {icon}
      <span>{children}</span>
    </span>
  );
}
