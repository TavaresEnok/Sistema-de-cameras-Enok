import unittest

import numpy as np

from detectors.motion import MotionDetector


class PerimeterIgnoredMotionTests(unittest.TestCase):
    def test_ignored_activity_is_only_diagnostic(self):
        detector = MotionDetector(zones=[{
            "kind": "exclude", "name": "Rua",
            "points": [[0, 0], [0.5, 0], [0.5, 1], [0, 1]],
        }])
        detector._warmup_frames = detector._warmup_total
        detector._warmup_total_current = detector._warmup_total
        mask = np.zeros((detector.frame_height, detector.frame_width), dtype=np.uint8)
        mask[40:85, 40:85] = 255
        detector._observe_ignored_motion(mask)
        self.assertIsNone(detector.diagnostics()["perimeter_ignored_motion"])
        detector._observe_ignored_motion(mask)
        self.assertEqual(detector.diagnostics()["perimeter_ignored_motion"]["zone"], "Rua")
        self.assertEqual(detector._zone_mask[50, 50], 0)

    def test_scene_wide_change_is_not_reported_as_ignored_movement(self):
        detector = MotionDetector(zones=[{
            "kind": "exclude", "name": "Rua",
            "points": [[0, 0], [0.5, 0], [0.5, 1], [0, 1]],
        }])
        mask = np.full((detector.frame_height, detector.frame_width), 255, dtype=np.uint8)
        detector._observe_ignored_motion(mask)
        detector._observe_ignored_motion(mask)
        self.assertIsNone(detector.diagnostics()["perimeter_ignored_motion"])


if __name__ == "__main__":
    unittest.main()
