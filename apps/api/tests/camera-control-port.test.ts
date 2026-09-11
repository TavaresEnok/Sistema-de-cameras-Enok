import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cameraControlPortCandidates,
  preferredCameraControlPort,
} from '../src/cameras/helpers/camera-control-port.helper';

test('porta ONVIF explícita tem prioridade sobre a porta HTTP', () => {
  assert.equal(preferredCameraControlPort({ onvifPort: 8899, httpPort: 8081 }), 8899);
  assert.deepEqual(cameraControlPortCandidates({ onvifPort: 8899, httpPort: 8081 }, [80]), [8899, 8081, 80]);
});

test('porta HTTP vira primeira candidata ONVIF quando ONVIF não foi informada', () => {
  assert.equal(preferredCameraControlPort({ onvifPort: null, httpPort: 8081 }), 8081);
  assert.deepEqual(cameraControlPortCandidates({ onvifPort: null, httpPort: 8081 }, [8080, 80]), [8081, 8080, 80]);
});
