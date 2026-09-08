let nextId = 1;
const listeners = new Set();
const queue = [];
let active = null;

function emit() {
  for (const listener of listeners) listener(active);
}

function pump() {
  if (active || queue.length === 0) return;
  active = queue.shift();
  emit();
}

function enqueue(config) {
  return new Promise((resolve) => {
    queue.push({ id: nextId++, ...config, resolve });
    pump();
  });
}

export function subscribeSystemDialog(listener) {
  listeners.add(listener);
  listener(active);
  return () => listeners.delete(listener);
}

export function settleSystemDialog(id, value) {
  if (!active || active.id !== id) return;
  const resolve = active.resolve;
  active = null;
  emit();
  resolve(value);
  queueMicrotask(pump);
}

export function requestText({
  title = "Enter details",
  message = "",
  label = "Details",
  defaultValue = "",
  placeholder = "",
  submitLabel = "Continue",
  cancelLabel = "Cancel",
  required = false,
  minLength = 0,
  multiline = false,
  trim = false,
} = {}) {
  return enqueue({
    kind: "text",
    title,
    message,
    label,
    defaultValue: defaultValue ?? "",
    placeholder,
    submitLabel,
    cancelLabel,
    required,
    minLength,
    multiline,
    trim,
  });
}

export function requestDateTime({
  title = "Select date and time",
  message = "",
  label = "Date and time",
  defaultValue = "",
  submitLabel = "Continue",
  cancelLabel = "Cancel",
  allowEmpty = false,
  emptyLabel = "No date · close manually",
} = {}) {
  return enqueue({
    kind: "datetime",
    title,
    message,
    label,
    defaultValue: defaultValue ?? "",
    submitLabel,
    cancelLabel,
    allowEmpty,
    emptyLabel,
  });
}

export function requestChoice({
  title = "Choose an option",
  message = "",
  label = "Option",
  options = [],
  defaultValue = "",
  submitLabel = "Continue",
  cancelLabel = "Cancel",
} = {}) {
  return enqueue({
    kind: "choice",
    title,
    message,
    label,
    options,
    defaultValue: defaultValue ?? "",
    submitLabel,
    cancelLabel,
  });
}

export function showNotice({
  title = "Done",
  message = "",
  buttonLabel = "OK",
} = {}) {
  return enqueue({ kind: "notice", title, message, buttonLabel });
}
