import { describe, it, expect } from 'vitest';
import { createLogger, getLogger } from '../../src/utils/logger.js';
import {
  WingmanError,
  ConfigError,
  ProjectError,
  SessionError,
  MessagingError,
  PermissionError,
  TimeoutError,
} from '../../src/utils/errors.js';

describe('Logger', () => {
  it('should create a logger instance', () => {
    const logger = createLogger('info', 'test-machine');
    expect(logger).toBeDefined();
    expect(logger.level).toBe('info');
  });

  it('should return the same logger from getLogger after creation', () => {
    createLogger('debug', 'test');
    const logger = getLogger();
    expect(logger).toBeDefined();
    expect(logger.level).toBe('debug');
  });
});

describe('Errors', () => {
  it('should create WingmanError with code', () => {
    const err = new WingmanError('test', 'TEST_CODE');
    expect(err.message).toBe('test');
    expect(err.code).toBe('TEST_CODE');
    expect(err.name).toBe('WingmanError');
    expect(err).toBeInstanceOf(Error);
  });

  it('should create ConfigError', () => {
    const err = new ConfigError('bad config');
    expect(err.code).toBe('CONFIG_ERROR');
    expect(err.name).toBe('ConfigError');
    expect(err).toBeInstanceOf(WingmanError);
  });

  it('should create ProjectError', () => {
    const err = new ProjectError('project not found');
    expect(err.code).toBe('PROJECT_ERROR');
    expect(err).toBeInstanceOf(WingmanError);
  });

  it('should create SessionError', () => {
    const err = new SessionError('session failed');
    expect(err.code).toBe('SESSION_ERROR');
    expect(err).toBeInstanceOf(WingmanError);
  });

  it('should create MessagingError', () => {
    const err = new MessagingError('messaging failed');
    expect(err.code).toBe('MESSAGING_ERROR');
    expect(err).toBeInstanceOf(WingmanError);
  });

  it('should create PermissionError', () => {
    const err = new PermissionError('denied');
    expect(err.code).toBe('PERMISSION_ERROR');
    expect(err).toBeInstanceOf(WingmanError);
  });

  it('should create TimeoutError', () => {
    const err = new TimeoutError('timed out');
    expect(err.code).toBe('TIMEOUT_ERROR');
    expect(err).toBeInstanceOf(WingmanError);
  });
});
