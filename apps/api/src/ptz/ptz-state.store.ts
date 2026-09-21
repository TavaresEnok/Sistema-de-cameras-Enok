import { Injectable } from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ConfigService } from '@nestjs/config';

type StoredPreset = {
  id: string;
  name: string;
  token: string;
};

type CameraPtzState = {
  onvifUsername?: string;
  onvifPasswordEncrypted?: string;
  capabilities?: Record<string, boolean>;
  presets?: StoredPreset[];
  /** Última rota CGI que realmente aceitou PTZ. Evita procurar portas a cada toque. */
  proprietaryRoute?: {
    cameraIp: string;
    port: number;
    channel: number;
  };
};

type PtzStateFile = {
  cameras: Record<string, CameraPtzState>;
};

@Injectable()
export class PtzStateStore {
  constructor(private readonly configService: ConfigService) {}

  private filePath() {
    const root = this.configService.get<string>('recordingsRoot') ?? './storage/recordings';
    return join(root, '.ptz', 'ptz-state.json');
  }

  private readState(): PtzStateFile {
    const file = this.filePath();
    if (!existsSync(file)) return { cameras: {} };
    try {
      const data = JSON.parse(readFileSync(file, 'utf-8')) as PtzStateFile;
      return data && typeof data === 'object' && data.cameras ? data : { cameras: {} };
    } catch {
      return { cameras: {} };
    }
  }

  private writeState(state: PtzStateFile) {
    const file = this.filePath();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(state, null, 2), 'utf-8');
  }

  getCamera(cameraId: string) {
    const state = this.readState();
    return state.cameras[cameraId] ?? {};
  }

  patchCamera(cameraId: string, patch: Partial<CameraPtzState>) {
    const state = this.readState();
    state.cameras[cameraId] = {
      ...(state.cameras[cameraId] ?? {}),
      ...patch,
    };
    this.writeState(state);
    return state.cameras[cameraId];
  }
}
