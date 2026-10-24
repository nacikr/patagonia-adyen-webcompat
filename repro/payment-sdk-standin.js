// Stand-in for adyen.js (Adyen Web SDK 5.x).
// It defines the same global the real SDK defines, window.AdyenCheckout,
// so the page can be tested without loading Adyen's servers.
// Block THIS file in DevTools to reproduce the breakage.

window.AdyenCheckout = async function (config) {
  return {
    create(type) {
      return {
        mount(selector) {
          document.querySelector(selector).innerHTML = `
            <label class="method"><input type="radio" name="pm" checked> Add a card</label>
            <div class="card-fields">
              <input placeholder="Name on card">
              <input placeholder="Card number">
              <input placeholder="Expiration date">
              <input placeholder="Security code">
            </div>
            <label class="method"><input type="radio" name="pm"> Afterpay</label>
            <label class="method"><input type="radio" name="pm"> Google Pay</label>
            <label class="method"><input type="radio" name="pm"> Klarna</label>`;
          return this;
        }
      };
    }
  };
};
