import type { CSSProperties, HTMLAttributes } from 'react';
import styles from './Skeleton.module.css';

interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  width?: CSSProperties['width'];
  height?: CSSProperties['height'];
}

export function Skeleton({ width = '100%', height = 16, style, className, ...rest }: SkeletonProps) {
  return (
    <div
      {...rest}
      className={[styles.skeleton, className || ''].join(' ').trim()}
      style={{ width, height, ...style }}
      aria-hidden="true"
    />
  );
}
