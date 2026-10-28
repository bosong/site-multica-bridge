

export function fitLaunchPosition(position, size, viewport) {
    const axis = (value, start, extent, length) => {
      const margin = Math.min(8, Math.max(0, (extent - length) / 2));
      const minimum = start + margin, maximum = Math.max(minimum, start + extent - length - margin);
      return Math.min(maximum, Math.max(minimum, Number.isFinite(Number(value)) ? Number(value) : minimum));
    };
    return { left: axis(position.left, viewport.left || 0, viewport.width, size.width),
      top: axis(position.top, viewport.top || 0, viewport.height, size.height) };
  }
