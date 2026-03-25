function PageState({ title, description, actionLabel, onAction, tone = "neutral" }) {
  return (
    <article className={`card page-state page-state-${tone}`}>
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      {actionLabel && onAction ? (
        <button type="button" className="page-state-action" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </article>
  );
}

export default PageState;
