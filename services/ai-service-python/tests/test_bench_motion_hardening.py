"""Tests for the offline hardening benchmark sampling contract."""

import unittest

from unittest import mock

from tests.bench_motion_hardening import read_reference_frame, validate_reference_video


class _Capture:
    def __init__(self, frames):
        self.frames = list(frames)

    def read(self):
        if not self.frames:
            return False, None
        return True, self.frames.pop(0)


class TestReferenceSampling(unittest.TestCase):
    def test_reads_the_original_source_frame_for_each_reference(self):
        capture = _Capture(list(range(20)))
        frame, index = read_reference_frame(capture, -1, 0)
        self.assertEqual((frame, index), (0, 0))

        frame, index = read_reference_frame(capture, index, 15)
        self.assertEqual((frame, index), (15, 15))

    def test_stops_cleanly_when_source_is_shorter_than_reference(self):
        capture = _Capture([0, 1])
        frame, index = read_reference_frame(capture, -1, 4)
        self.assertIsNone(frame)
        self.assertEqual(index, 1)

    @mock.patch("tests.bench_motion_hardening.cv2.VideoCapture")
    def test_rejects_a_different_video_cadence(self, video_capture):
        video_capture.return_value.get.return_value = 30.0
        with self.assertRaisesRegex(ValueError, "vídeo incompatível"):
            validate_reference_video(
                "/captures/cam-01.ts",
                {"video": "cam-01.mp4", "native_fps": 2.0},
            )

    @mock.patch("tests.bench_motion_hardening.cv2.VideoCapture")
    def test_accepts_the_exact_reference_video(self, video_capture):
        video_capture.return_value.get.return_value = 2.0
        validate_reference_video(
            "/proxy/cam-01.mp4",
            {"video": "cam-01.mp4", "native_fps": 2.0},
        )


if __name__ == "__main__":
    unittest.main()
