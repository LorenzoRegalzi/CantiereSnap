import { createLogger } from '../logger';

let stdoutBuf = '';
let stderrBuf = '';

beforeEach(() => {
  stdoutBuf = '';
  stderrBuf = '';
  jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => { stdoutBuf += chunk; return true; });
  jest.spyOn(process.stderr, 'write').mockImplementation((chunk) => { stderrBuf += chunk; return true; });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function lastStdout(): Record<string, unknown> {
  return JSON.parse(stdoutBuf.trim().split('\n').at(-1)!);
}
function lastStderr(): Record<string, unknown> {
  return JSON.parse(stderrBuf.trim().split('\n').at(-1)!);
}

describe('createLogger', () => {
  it('info writes JSON to stdout with correct fields', () => {
    const log = createLogger('jobs', 'req-001', 'user-abc');
    log.info('test message', { key: 'val' });

    const entry = lastStdout();
    expect(entry.level).toBe('INFO');
    expect(entry.handler).toBe('jobs');
    expect(entry.requestId).toBe('req-001');
    expect(entry.userId).toBe('user-abc');
    expect(entry.message).toBe('test message');
    expect((entry.data as Record<string, unknown>).key).toBe('val');
    expect(typeof entry.timestamp).toBe('string');
    expect(stderrBuf).toBe('');
  });

  it('warn writes JSON to stdout with level WARN', () => {
    const log = createLogger('ocr', 'req-002');
    log.warn('something odd');

    const entry = lastStdout();
    expect(entry.level).toBe('WARN');
    expect(entry.handler).toBe('ocr');
    expect(entry.message).toBe('something odd');
    expect(stderrBuf).toBe('');
  });

  it('error writes JSON to stderr with level ERROR', () => {
    const log = createLogger('auth', 'req-003', 'user-xyz');
    log.error('something broke', new Error('boom'));

    const entry = lastStderr();
    expect(entry.level).toBe('ERROR');
    expect(entry.message).toBe('something broke');
    expect(stdoutBuf).toBe('');
  });

  it('omits userId when not provided', () => {
    const log = createLogger('dashboard', 'req-004');
    log.info('no user');

    const entry = lastStdout();
    expect('userId' in entry).toBe(false);
  });

  it('omits data field when not provided', () => {
    const log = createLogger('jobs', 'req-005', 'u1');
    log.info('no data');

    const entry = lastStdout();
    expect('data' in entry).toBe(false);
  });

  it('timestamp is a valid ISO 8601 string', () => {
    const log = createLogger('jobs', 'req-006');
    log.info('ts check');

    const entry = lastStdout();
    expect(new Date(entry.timestamp as string).toISOString()).toBe(entry.timestamp);
  });

  it('each log line is valid JSON terminated with newline', () => {
    const log = createLogger('jobs', 'req-007');
    log.info('line 1');
    log.info('line 2');

    const lines = stdoutBuf.trim().split('\n');
    expect(lines).toHaveLength(2);
    lines.forEach((line) => expect(() => JSON.parse(line)).not.toThrow());
  });

  it('data field accepts any serialisable value', () => {
    const log = createLogger('jobs', 'req-008');
    log.info('with array', [1, 2, 3]);

    const entry = lastStdout();
    expect(entry.data).toEqual([1, 2, 3]);
  });
});
