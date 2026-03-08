import type { ReactNode } from 'react';
import styles from './EmptyState.module.css';

interface EmptyStateProps {
  title: string;
  message: string;
  icon?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ title, message, icon = '◌', action }: EmptyStateProps) {
  return (
    <section className={styles.wrap}>
      <div className={styles.icon} aria-hidden="true">{icon}</div>
      <h3 className={styles.title}>{title}</h3>
      <p className={styles.text}>{message}</p>
      {action ? <div className={styles.action}>{action}</div> : null}
    </section>
  );
}
