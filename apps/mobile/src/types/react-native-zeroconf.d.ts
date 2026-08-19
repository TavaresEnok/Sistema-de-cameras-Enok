declare module 'react-native-zeroconf' {
  import { EventEmitter } from 'events';
  export default class Zeroconf extends EventEmitter {
    scan(type?: string, protocol?: string, domain?: string, implType?: string): void;
    stop(implType?: string): void;
    removeDeviceListeners(): void;
  }
}
