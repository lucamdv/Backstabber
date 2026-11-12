export function OnlineDeal() {
  return <div className="online-deal" data-testid="online-deal" aria-hidden="true">
    <div className="online-deal-stack">
      {[0, 1, 2].map(card => <img src="images/verso_card.png" alt="" key={card} />)}
    </div>
    <span>Distribuindo influências</span>
  </div>;
}

export function OnlineBackstab() {
  return <div className="online-backstab" data-testid="online-backstab">
    <div className="online-backstab-brand" aria-hidden="true"><img src="images/isologo.png" alt="" /></div>
    <strong>BACKSTAB</strong>
  </div>;
}
