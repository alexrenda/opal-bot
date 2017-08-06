// Apparently, TypeScript doesn't have EventSource in its standard
// libraries yet? So we declare what we need here.
declare class EventSource {
  constructor (url: string, opts?: { withCredentials: boolean });
  addEventListener: (type: string, handler: (event: MessageEvent) => void)
    => void;
}

document.addEventListener("DOMContentLoaded", () => {
  let incomingList = document.querySelector("#incoming") as HTMLElement;
  let outgoingForm = document.querySelector("form")!;
  let outgoingBox = document.querySelector("#outgoing") as HTMLInputElement;

  // Add a message to our chat log.
  function addMessage(who: string, msg: string) {
    let li = document.createElement("li");

    // Author.
    let whoSpan = document.createElement("span");
    whoSpan.classList.add('who');
    whoSpan.innerText = who;
    li.appendChild(whoSpan);

    // Message text.
    let msgSpan = document.createElement("span");
    msgSpan.className = "message-text";
    msgSpan.innerHTML = msg;
    li.appendChild(msgSpan);

    incomingList.appendChild(li);

    // To show the message.
    incomingList.scrollTop = incomingList.scrollHeight;
  }

  // Wait for incoming messages.
  let eventSource = new EventSource("/chat/messages");
  eventSource.addEventListener('message', (e) => {
    let msg = JSON.parse(e.data);
    if (msg) {
      addMessage(msg['who'], msg['text']);
    }
  });

  // Send outgoing messages.
  outgoingForm.addEventListener("submit", (e) => {
    // Get the message from the text box.
    let message = outgoingBox.value;

    // Send the message to the server.
    fetch(outgoingForm.target, {
      method: 'POST',
      body: message,
    });

    // Clear input. No normal form submission.
    outgoingBox.value = '';
    e.preventDefault();
  });

  // Start with focus on input box.
  outgoingBox.focus();

  // Characters typed when not focused bring the focus back.
  let body = document.querySelector('body')!;
  body.addEventListener("keypress", (e) => {
    outgoingBox.focus();
  });
});
