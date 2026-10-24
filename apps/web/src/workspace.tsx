import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  type Actor,
  money,
  type OrderView,
  ordersContract,
  type ReturnView,
  returnDetailContract,
  returnsContract,
} from "../../../packages/contracts/src/index.ts";
import { ReturnActions } from "./actions.tsx";
import { api } from "./api.ts";
import { date, dateTime, refundLabel, stateLabel } from "./format.ts";
import { RefundPanel } from "./refund.tsx";

function ReturnForm({ order, onCreated }: { order: OrderView; onCreated: (id: string) => void }) {
  const client = useQueryClient();
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const selected = order.lines
    .map((line) => ({ lineId: line.id, quantity: quantities[line.id] ?? 0 }))
    .filter((item) => item.quantity > 0);
  const amount = order.lines.reduce(
    (sum, line) =>
      sum +
      line.unitValues.slice(0, quantities[line.id] ?? 0).reduce((value, unit) => value + unit, 0),
    0,
  );
  const create = useMutation({
    mutationFn: async () =>
      returnDetailContract.assert(
        await api("/returns", { orderId: order.id, requestKey, reason, items: selected }),
      ),
    onSuccess: async (result) => {
      await client.invalidateQueries({ queryKey: ["orders"] });
      await client.invalidateQueries({ queryKey: ["returns"] });
      onCreated(result.id);
    },
  });
  return (
    <section className="detail-pane" aria-labelledby="request-title">
      <div className="pane-heading">
        <span>Customer return</span>
        <h2 id="request-title" tabIndex={-1}>
          {order.number}
        </h2>
        <p>Delivered {date(order.deliveredAt)}</p>
      </div>
      <div className={`notice ${order.eligible ? "notice-info" : "notice-warning"}`}>
        {order.eligible
          ? `Return window closes ${dateTime(order.deadline)}.`
          : `The 30-day return window closed ${dateTime(order.deadline)}.`}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <h3>Select items to return</h3>
        {order.lines.map((line) => (
          <div className="item-row" key={line.id}>
            <div className="item-swatch" aria-hidden="true">
              {line.name.includes("tee") ? "T" : "C"}
            </div>
            <div className="item-description">
              <strong>{line.name}</strong>
              <span>{line.variant}</span>
              <small>
                {line.available} of {line.quantity} units available
              </small>
            </div>
            <label className="quantity-label">
              Quantity
              <input
                aria-label={`Return quantity for ${line.name}`}
                type="number"
                min={0}
                max={line.available}
                value={quantities[line.id] ?? 0}
                disabled={!order.eligible || create.isPending}
                onChange={(event) => {
                  const value = event.target.valueAsNumber;
                  setQuantities({ ...quantities, [line.id]: Number.isFinite(value) ? value : 0 });
                  setRequestKey(crypto.randomUUID());
                  create.reset();
                }}
              />
            </label>
          </div>
        ))}
        <label className="field">
          Why are you returning these items?
          <textarea
            value={reason}
            minLength={3}
            maxLength={500}
            required
            disabled={!order.eligible || create.isPending}
            placeholder="For example, the fit is larger than expected."
            onChange={(event) => {
              setReason(event.target.value);
              setRequestKey(crypto.randomUUID());
              create.reset();
            }}
          />
        </label>
        <div className="amount-line">
          <span>Requested merchandise refund</span>
          <strong>{money(amount, order.currency)}</strong>
        </div>
        <p className="muted small">
          Support will review your request before you send anything back. Shipping is excluded.
        </p>
        {create.isError && (
          <p className="error" role="alert">
            {create.error.message}
          </p>
        )}
        <button
          className="primary"
          type="submit"
          disabled={
            !order.eligible || !selected.length || reason.trim().length < 3 || create.isPending
          }
        >
          {create.isPending ? "Sending request…" : "Request return"}
        </button>
      </form>
    </section>
  );
}

export function ReturnDetail({ request, actor }: { request: ReturnView; actor: Actor }) {
  return (
    <section className="detail-pane" aria-labelledby="return-title">
      <div className="pane-heading">
        <span>Return {request.id.slice(0, 8).toUpperCase()}</span>
        <h2 id="return-title" tabIndex={-1}>
          {request.orderNumber}
        </h2>
        <span className={`status status-${request.status}`}>{stateLabel(request.status)}</span>
      </div>
      <dl className="detail-facts">
        <div>
          <dt>Customer</dt>
          <dd>{request.customerName}</dd>
        </div>
        <div>
          <dt>Requested</dt>
          <dd>{date(request.requestedAt)}</dd>
        </div>
        <div>
          <dt>Merchandise value</dt>
          <dd>{money(request.amountMinor, request.currency)}</dd>
        </div>
      </dl>
      {request.status === "requested" && (
        <p className="notice notice-info">Support will review this request next.</p>
      )}
      {request.status === "approved" && (
        <p className="notice notice-info">
          Approved. Waiting for the warehouse to receive the items.
        </p>
      )}
      {request.status === "received" && (
        <p className="notice notice-info">Items received. Warehouse inspection is next.</p>
      )}
      {request.closureReason && request.closureReason !== "refunded" && (
        <div className="notice notice-warning">
          <strong>
            {request.closureReason === "rejected"
              ? "Request rejected"
              : "Return closed after failed inspection"}
          </strong>
          <p>
            {
              request.reviews.find(
                (review) => review.outcome === "rejected" || review.outcome === "failed",
              )?.reason
            }
          </p>
        </div>
      )}
      {request.status === "inspection_passed" && !request.refund && (
        <div className="notice notice-info">
          Inspection passed. This return is ready for finance to review the refund.
        </div>
      )}
      <h3>Return reason</h3>
      <p>{request.reason}</p>
      <h3>Selected items</h3>
      {request.items.map((item) => (
        <div className="item-row" key={item.unitId}>
          <div className="item-swatch" aria-hidden="true">
            {item.name.includes("tee") ? "T" : "C"}
          </div>
          <div className="item-description">
            <strong>{item.name}</strong>
            <span>{item.variant}</span>
          </div>
          <strong>{money(item.amountMinor, request.currency)}</strong>
        </div>
      ))}
      <div className="policy-note">
        <strong>Policy applied</strong>
        <p>
          Net merchandise value within 30 days of delivery. Deadline {dateTime(request.deadline)}.
          Shipping excluded.
        </p>
        <span>{request.policyVersion}</span>
      </div>
      <ReturnActions key={`${request.id}-${request.status}`} actor={actor} request={request} />
      <RefundPanel key={`refund-${request.id}`} actor={actor} request={request} />
      <h3>Decision history</h3>
      <ol className="timeline">
        {request.history.map((event) => (
          <li key={event.id}>
            <strong>{event.event}</strong>
            <p>{event.reason}</p>
            <small>
              {event.actorName}, {dateTime(event.at)}
            </small>
            {event.refundToStatus && (
              <span className="history-state">
                {event.refundFromStatus ? `${refundLabel(event.refundFromStatus)} to ` : ""}
                {refundLabel(event.refundToStatus)}
              </span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function Workspace({ actor }: { actor: Actor }) {
  const customer = actor.role === "customer";
  const [orderId, setOrderId] = useState<string | null>(null);
  const [returnId, setReturnId] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const detailPane = useRef<HTMLDivElement>(null);
  const queuePane = useRef<HTMLElement>(null);
  const previouslySelected = useRef(false);
  const orders = useQuery({
    queryKey: ["orders", actor.id],
    queryFn: async () => ordersContract.assert(await api("/orders")),
    enabled: customer,
  });
  const returns = useQuery({
    queryKey: ["returns", actor.id],
    queryFn: async () => returnsContract.assert(await api("/returns")),
    refetchInterval: (query) =>
      query.state.data?.some(
        (item) =>
          item.refundStatus === "pending" ||
          item.refundStatus === "processing" ||
          item.refundStatus === "unknown",
      )
        ? 1000
        : false,
  });
  const detail = useQuery({
    queryKey: ["return", actor.id, returnId],
    queryFn: async () => returnDetailContract.assert(await api(`/returns/${returnId}`)),
    enabled: Boolean(returnId),
    refetchInterval: (query) =>
      query.state.data?.refund?.status === "pending" ||
      query.state.data?.refund?.status === "processing" ||
      query.state.data?.refund?.status === "unknown"
        ? 1000
        : false,
  });
  const order = orders.data?.find((item) => item.id === orderId);
  const selectedId = order?.id ?? detail.data?.id;
  const hasSelection = Boolean(orderId || returnId);
  useEffect(() => {
    if (!selectedId) return;
    const heading = detailPane.current?.querySelector<HTMLElement>("h2");
    heading?.focus();
    detailPane.current?.scrollIntoView({ block: "start" });
  }, [selectedId]);
  useEffect(() => {
    if (previouslySelected.current && !hasSelection) queuePane.current?.focus();
    previouslySelected.current = hasSelection;
  }, [hasSelection]);
  const visibleReturns = returns.data?.filter((item) => {
    const matchesFilter =
      filter === "all" ||
      (filter === "open" && item.status !== "closed") ||
      (filter === "ready" && item.status === "inspection_passed" && !item.refundStatus) ||
      (filter === "unknown" && item.refundStatus === "unknown") ||
      (filter === "closed" && item.status === "closed");
    return (
      matchesFilter &&
      `${item.orderNumber} ${item.customerName} ${item.id}`
        .toLowerCase()
        .includes(search.trim().toLowerCase())
    );
  });
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="breadcrumb">{actor.merchantName} / Returns</p>
          <h1>{customer ? "Your orders & returns" : "Return requests"}</h1>
          <p>
            {customer
              ? "Choose the items you want to return. Follow every decision here."
              : "Review each request, follow its history, and take the next step."}
          </p>
        </div>
        <div className="role-label">{actor.role} workspace</div>
      </div>
      <div className={`workspace-grid ${hasSelection ? "has-selection" : ""}`}>
        <section
          ref={queuePane}
          tabIndex={-1}
          className="queue-pane"
          aria-label={customer ? "Customer orders and returns" : "Merchant return queue"}
        >
          {customer && (
            <>
              <h2>Your orders</h2>
              {orders.isPending && <p role="status">Loading orders…</p>}
              {orders.isError && (
                <p className="error" role="alert">
                  {orders.error.message}
                  <button type="button" onClick={() => orders.refetch()}>
                    Try again
                  </button>
                </p>
              )}
              {orders.data?.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={`order-tile ${item.id === orderId ? "selected" : ""}`}
                  aria-current={item.id === orderId ? "true" : undefined}
                  onClick={() => {
                    setOrderId(item.id);
                    setReturnId(null);
                  }}
                >
                  <span>
                    <strong>{item.number}</strong>
                    <small>Delivered {date(item.deliveredAt)}</small>
                  </span>
                  <span className={`status ${item.eligible ? "status-open" : "status-closed"}`}>
                    {item.eligible ? "Return window open" : "Window closed"}
                  </span>
                </button>
              ))}
            </>
          )}
          <div className="section-heading">
            <h2>{customer ? "Your returns" : "Queue"}</h2>
            <span>
              {visibleReturns?.length ?? 0} of {returns.data?.length ?? 0}
            </span>
          </div>
          <div className="queue-controls">
            <label className="field">
              Find returns
              <input
                type="search"
                placeholder="Order, customer, or return ID"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <label className="field">
              Return filter
              <select value={filter} onChange={(event) => setFilter(event.target.value)}>
                <option value="all">All returns</option>
                <option value="open">Open returns</option>
                <option value="ready">Ready for finance</option>
                <option value="unknown">Needs status check</option>
                <option value="closed">Closed returns</option>
              </select>
            </label>
          </div>
          {returns.isPending && <p role="status">Loading returns…</p>}
          {returns.isError && (
            <p className="error" role="alert">
              {returns.error.message}
              <button type="button" onClick={() => returns.refetch()}>
                Try again
              </button>
            </p>
          )}
          {returns.data?.length === 0 && (
            <div className="empty-state">
              <h3>No return requests yet</h3>
              <p>
                {customer
                  ? "Select an order above to start a return."
                  : "Customer requests for this merchant will appear here."}
              </p>
            </div>
          )}
          {returns.data && returns.data.length > 0 && visibleReturns?.length === 0 && (
            <div className="empty-state">
              <h3>No matching returns</h3>
              <p>Change the search or filter to see other requests.</p>
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setFilter("all");
                }}
              >
                Clear filters
              </button>
            </div>
          )}
          {visibleReturns?.map((item) => (
            <button
              type="button"
              key={item.id}
              className={`queue-row ${item.id === returnId ? "selected" : ""}`}
              aria-current={item.id === returnId ? "true" : undefined}
              aria-label={`Return ${item.id.slice(0, 8).toUpperCase()} for ${item.orderNumber}, ${item.customerName}, ${money(item.amountMinor, item.currency)}, ${stateLabel(item.status)}${item.refundStatus ? `, refund ${refundLabel(item.refundStatus).toLowerCase()}` : ""}`}
              onClick={() => {
                setReturnId(item.id);
                setOrderId(null);
              }}
            >
              <div>
                <strong>{item.orderNumber}</strong>
                <span>{item.customerName}</span>
                <small>
                  {date(item.requestedAt)} · Return {item.id.slice(0, 8).toUpperCase()}
                </small>
              </div>
              <div className="queue-value">
                <strong>{money(item.amountMinor, item.currency)}</strong>
                <span className={`status status-${item.status}`}>{stateLabel(item.status)}</span>
                {item.refundStatus && (
                  <span className={`status status-refund-${item.refundStatus}`}>
                    Refund {refundLabel(item.refundStatus).toLowerCase()}
                  </span>
                )}
              </div>
            </button>
          ))}
        </section>
        <div ref={detailPane} className="selected-pane">
          {hasSelection && (
            <button
              type="button"
              className="back-to-queue"
              onClick={() => {
                setOrderId(null);
                setReturnId(null);
              }}
            >
              {customer ? "Back to orders and returns" : "Back to return queue"}
            </button>
          )}
          {order ? (
            <ReturnForm
              key={order.id}
              order={order}
              onCreated={(id) => {
                setReturnId(id);
                setOrderId(null);
              }}
            />
          ) : detail.data ? (
            <ReturnDetail request={detail.data} actor={actor} />
          ) : detail.isFetching ? (
            <section className="detail-pane" role="status">
              Loading return…
            </section>
          ) : (
            <section className="empty-detail">
              <div className="empty-symbol" aria-hidden="true">
                ↶
              </div>
              <h2>{customer ? "Start with an order" : "Choose a request"}</h2>
              <p>
                {customer
                  ? "Select an order to see its return window and available items, or open a return to follow its progress."
                  : "Its items, policy, and decision history will appear here."}
              </p>
              {detail.isError && (
                <p role="alert" className="error">
                  {detail.error.message}
                  <button type="button" onClick={() => detail.refetch()}>
                    Try again
                  </button>
                </p>
              )}
            </section>
          )}
        </div>
      </div>
    </>
  );
}
