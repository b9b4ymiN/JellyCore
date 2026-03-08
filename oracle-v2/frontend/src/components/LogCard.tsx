import { memo } from 'react';
import { Link } from 'react-router-dom';
import type { Document } from '../api/oracle';
import styles from './LogCard.module.css';

interface LogCardProps {
  doc: Document;
}

function tryFormatDate(dateStr: string): string | null {
  try {
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return null;
  }
}

function parseMetadata(doc: Document) {
  const source = doc.source_file || '';
  const content = doc.content || '';

  let when = 'Unknown date';

  const isoDateMatch = source.match(/(\d{4}-\d{2}-\d{2})/);
  if (isoDateMatch) {
    const formatted = tryFormatDate(isoDateMatch[1]);
    if (formatted) when = formatted;
  }

  if (when === 'Unknown date') {
    const pathDateMatch = source.match(/(\d{4})\/(\d{2})\/(\d{2})/);
    if (pathDateMatch) {
      const formatted = tryFormatDate(`${pathDateMatch[1]}-${pathDateMatch[2]}-${pathDateMatch[3]}`);
      if (formatted) when = formatted;
    }
  }

  if (when === 'Unknown date') {
    const altPathMatch = source.match(/(\d{4})-(\d{2})\/(\d{2})/);
    if (altPathMatch) {
      const formatted = tryFormatDate(`${altPathMatch[1]}-${altPathMatch[2]}-${altPathMatch[3]}`);
      if (formatted) when = formatted;
    }
  }

  if (when === 'Unknown date' && doc.id) {
    const idDateMatch = doc.id.match(/(\d{4}-\d{2}-\d{2})/);
    if (idDateMatch) {
      const formatted = tryFormatDate(idDateMatch[1]);
      if (formatted) when = formatted;
    }
  }

  if (when === 'Unknown date') {
    const contentDateMatch = content.match(/Date:\s*(\d{4}-\d{2}-\d{2})/i);
    if (contentDateMatch) {
      const formatted = tryFormatDate(contentDateMatch[1]);
      if (formatted) when = formatted;
    }
  }

  const how = source.includes('resonance')
    ? 'Resonance'
    : source.includes('retrospective')
      ? 'Session'
      : source.includes('learnings')
        ? 'Discovery'
        : 'Knowledge Base';

  return { when, how };
}

function parseFrontmatter(content: string): { title: string | null; body: string } {
  const trimmed = content.trim();

  if (trimmed.startsWith('---')) {
    const endIndex = trimmed.indexOf('---', 3);
    if (endIndex !== -1) {
      const frontmatter = trimmed.slice(3, endIndex);
      const body = trimmed.slice(endIndex + 3).trim();
      const titleMatch = frontmatter.match(/title:\s*["']?([^"'\n]+)["']?/);
      const title = titleMatch ? titleMatch[1].trim() : null;
      return { title, body };
    }
  }

  return { title: null, body: trimmed };
}

function getPreview(content: string): string {
  const { body } = parseFrontmatter(content);
  const cleaned = body.replace(/\*\*/g, '').replace(/`/g, '').replace(/^#+\s*/gm, '').trim();
  if (cleaned.length <= 150) return cleaned;
  return `${cleaned.slice(0, 150).trim()}...`;
}

function getTitle(content: string): string {
  const { title, body } = parseFrontmatter(content);
  if (title) return title.length <= 80 ? title : `${title.slice(0, 80).trim()}...`;

  const cleaned = body.replace(/\*\*/g, '').replace(/`/g, '').replace(/^#+\s*/gm, '').trim();
  const firstLine = cleaned.split('\n')[0] || 'Untitled';
  return firstLine.length <= 80 ? firstLine : `${firstLine.slice(0, 80).trim()}...`;
}

const TYPE_META: Record<Document['type'], { label: string; token: string }> = {
  principle: { label: 'Principle', token: 'PR' },
  pattern: { label: 'Pattern', token: 'PT' },
  learning: { label: 'Learning', token: 'LE' },
  retro: { label: 'Retro', token: 'RE' },
};

export const LogCard = memo(function LogCard({ doc }: LogCardProps) {
  const { when, how } = parseMetadata(doc);
  const title = getTitle(doc.content);
  const preview = getPreview(doc.content);
  const docId = encodeURIComponent(doc.id);
  const typeMeta = TYPE_META[doc.type] || { label: doc.type, token: 'KB' };

  return (
    <Link to={`/doc/${docId}`} state={{ doc }} className={styles.card}>
      <div className={styles.meta}>
        <span className={styles.when}>{when}</span>
        <span className={styles.dot}>.</span>
        <span className={`${styles.typeBadge} ${styles[doc.type]}`}>{typeMeta.token} {typeMeta.label}</span>
        <span className={styles.dot}>.</span>
        <span className={styles.how}>{how}</span>
      </div>

      <h2 className={styles.title}>{title}</h2>

      <p className={styles.preview}>{preview}</p>

      {doc.concepts && doc.concepts.length > 0 && (
        <div className={styles.tags}>
          {doc.concepts.slice(0, 5).map((tag) => (
            <span key={tag} className={styles.tag}>{tag}</span>
          ))}
          {doc.concepts.length > 5 && (
            <span className={styles.moreTag}>+{doc.concepts.length - 5}</span>
          )}
        </div>
      )}
    </Link>
  );
});
