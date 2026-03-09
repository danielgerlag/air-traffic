export class AirTrafficError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'AirTrafficError';
  }
}

export class ConfigError extends AirTrafficError {
  constructor(message: string) {
    super(message, 'CONFIG_ERROR');
    this.name = 'ConfigError';
  }
}

export class ProjectError extends AirTrafficError {
  constructor(message: string) {
    super(message, 'PROJECT_ERROR');
    this.name = 'ProjectError';
  }
}

export class SessionError extends AirTrafficError {
  constructor(message: string) {
    super(message, 'SESSION_ERROR');
    this.name = 'SessionError';
  }
}

export class MessagingError extends AirTrafficError {
  constructor(message: string) {
    super(message, 'MESSAGING_ERROR');
    this.name = 'MessagingError';
  }
}

export class PermissionError extends AirTrafficError {
  constructor(message: string) {
    super(message, 'PERMISSION_ERROR');
    this.name = 'PermissionError';
  }
}

export class TimeoutError extends AirTrafficError {
  constructor(message: string) {
    super(message, 'TIMEOUT_ERROR');
    this.name = 'TimeoutError';
  }
}
