import Konva from 'konva';

/**
 * Konva draws a semi-transparent shape that has both a fill and a stroke through a buffer canvas the size of
 * the screen (clear, draw, copy back) so the stroke does not show through the fill. With the main plan dimmed
 * in Wiring mode that is hundreds of full-screen copies per frame, which loads weak GPUs fully while panning
 * or zooming. The plan has no shadows, so shapes are drawn straight onto the layer.
 */
Konva.Shape.prototype._useBufferCanvas = function () {
  return false;
};
