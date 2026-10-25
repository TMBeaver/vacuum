function trayPopupBounds(anchor, work) {
  const width = Math.min(440, work.width - 16);
  const height = Math.min(500, work.height - 16);
  const below = anchor.y + anchor.height + 8;
  const above = anchor.y - height - 8;
  return {
    x: Math.round(
      Math.max(
        work.x + 8,
        Math.min(
          anchor.x + anchor.width / 2 - width / 2,
          work.x + work.width - width - 8,
        ),
      ),
    ),
    y: Math.round(
      Math.max(
        work.y + 8,
        Math.min(
          above >= work.y ? above : below,
          work.y + work.height - height - 8,
        ),
      ),
    ),
    width,
    height,
  };
}
module.exports = { trayPopupBounds };
