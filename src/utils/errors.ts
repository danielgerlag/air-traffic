export class WingmanError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'WingmanError';
  }
}

export class ConfigError extends WingmanError {
  constructor(message: string) {
    super(message, 'CONFIG_ERROR');
    this.name = 'ConfigError';
  }
}

export class ProjectError extends WingmanError {
  constructor(message: string) {
    super(message, 'PROJECT_ERROR');
    this.name = 'ProjectError';
  }
}

export class SessionError extends WingmanError {
  constructor(message: string) {
    super(message, 'SESSION_ERROR');
    this.name = 'SessionError';
  }
}

export class MessagingError extends WingmanError {
  constructor(message: string) {
    super(message, 'MESSAGING_ERROR');
    this.name = 'MessagingError';
  }
}

export class PermissionError extends WingmanError {
  constructor(message: string) {
    super(message, 'PERMISSION_ERROR');
    this.name = 'PermissionError';
  }
}

export class TimeoutError extends WingmanError {
  constructor(message: string) {
    super(message, 'TIMEOUT_ERROR');
    this.name = 'TimeoutError';
  }
}
