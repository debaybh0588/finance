function TablePagination({
  totalItems = 0,
  page = 1,
  pageSize = 10,
  pageSizeOptions = [10, 20, 50],
  onPageChange,
  onPageSizeChange
}) {
  if (!Number.isFinite(totalItems) || totalItems <= 0) return null;

  const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : 10;
  const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
  const safePage = Math.min(Math.max(1, Math.floor(page || 1)), totalPages);
  const start = (safePage - 1) * safePageSize + 1;
  const end = Math.min(totalItems, safePage * safePageSize);

  return (
    <div className="table-pagination" role="navigation" aria-label="Table pagination">
      <p className="table-pagination-info">
        Showing {start}-{end} of {totalItems}
      </p>

      <div className="table-pagination-controls">
        <label>
          Rows
          <select
            value={safePageSize}
            onChange={(event) => {
              const nextSize = Number(event.target.value);
              if (Number.isFinite(nextSize) && nextSize > 0) {
                onPageSizeChange?.(nextSize);
              }
            }}
          >
            {pageSizeOptions.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={() => onPageChange?.(safePage - 1)}
          disabled={safePage <= 1}
          aria-label="Previous page"
        >
          Prev
        </button>

        <span className="table-pagination-page">
          {safePage}/{totalPages}
        </span>

        <button
          type="button"
          onClick={() => onPageChange?.(safePage + 1)}
          disabled={safePage >= totalPages}
          aria-label="Next page"
        >
          Next
        </button>
      </div>
    </div>
  );
}

export default TablePagination;
