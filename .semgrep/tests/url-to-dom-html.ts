const fragment = window.location.hash;
// ruleid: domaine-url-to-dom-html
element.innerHTML = fragment;
// ruleid: domaine-url-to-dom-html
element.insertAdjacentHTML("beforeend", location.search);
const url = new URL(window.location.href);
// ruleid: domaine-url-to-dom-html
element.outerHTML = url.searchParams.get("html");
// ruleid: domaine-url-to-dom-html
document.write(document.location.hash);
// ok: domaine-url-to-dom-html
element.textContent = fragment;
// ok: domaine-url-to-dom-html
element.innerHTML = "<strong>Fixed content</strong>";
const fixedURL = new URL("https://example.test/?html=fixed");
// ok: domaine-url-to-dom-html
otherElement.innerHTML = fixedURL.searchParams.get("html");
