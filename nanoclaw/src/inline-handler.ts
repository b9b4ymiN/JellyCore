/**
 * Inline Handler — Template responses for trivial messages
 *
 * No container spawn, no API call. <50ms response time.
 */

const responses: Record<string, string[]> = {
  greeting: [
    'สวัสดีครับ! มีอะไรให้ช่วยไหม? 🤖',
    'หวัดดีครับ! พร้อมช่วยเสมอ',
    'สวัสดีครับ!',
  ],
  thanks: [
    'ยินดีครับ! 😊',
    'ยินดีช่วยเสมอครับ',
    'ไม่เป็นไรครับ',
  ],
  ack: [
    'รับทราบครับ ✅',
    '👍',
  ],
  'admin-cmd': [], // handled separately
};

function randomPick(arr: string[]): string {
  if (arr.length === 0) return '✅';
  return arr[Math.floor(Math.random() * arr.length)];
}

export function handleInline(reason: string, message: string): string {
  // Admin commands
  if (reason === 'admin-cmd') {
    const cmd = message.trim().split(/\s+/)[0].toLowerCase();
    switch (cmd) {
      case '/status': return '🟢 System running';
      case '/health': return '🟢 All services healthy';
      case '/help': return [
        '📋 Available commands:',
        '/status — System status',
        '/health — Health check',
        '/help — This help message',
      ].join('\n');
      default: return `Unknown command: ${cmd}`;
    }
  }

  return randomPick(responses[reason] || responses.ack);
}
