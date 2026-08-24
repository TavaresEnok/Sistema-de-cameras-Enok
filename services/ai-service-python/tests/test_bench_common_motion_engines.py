import cv2
import numpy as np
import unittest

from tests.bench_common_motion_engines import FrigateAverageCore, InjectedMotionDetector


class TestCommonMotionEngines(unittest.TestCase):
    def test_frigate_core_detects_local_change_and_honors_freeze(self):
        engine = FrigateAverageCore(threshold=30)
        background = np.zeros((60, 80, 3), dtype=np.uint8)
        changed = background.copy()
        changed[20:40, 25:55] = 255

        self.assertEqual(np.count_nonzero(engine.apply(background, learningRate=0.1)), 0)
        first = engine.apply(changed, learningRate=0.0)
        second = engine.apply(changed, learningRate=0.0)
        self.assertEqual(np.count_nonzero(first), 600)
        self.assertTrue(np.array_equal(first, second))

    def test_injected_detector_reuses_drac_filters_with_knn(self):
        detector = InjectedMotionDetector(
            lambda: cv2.createBackgroundSubtractorKNN(
                history=30, dist2Threshold=400.0, detectShadows=True
            ),
            "test_knn",
        )
        detector.load()
        self.assertEqual(detector.diagnostics()["engine"], "test_knn")
        self.assertTrue(detector.diagnostics()["common_drac_filters"])


if __name__ == "__main__":
    unittest.main()
