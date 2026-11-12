(function () {
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function initWidget(root) {
    if (!root || root.dataset.spInitialized === "true") return;
    root.dataset.spInitialized = "true";

    var shop = root.dataset.shop || "";
    var productId = root.dataset.productId || "";
    var productTitle = root.dataset.productTitle || "";
    var productHandle = root.dataset.productHandle || "";
    var endpoint = root.dataset.endpoint || "/apps/stockpulse/api/subscribe";
    var settingsEndpoint =
      root.dataset.settingsEndpoint || "/apps/stockpulse/api/settings";
    var displayMode = root.dataset.displayMode || "inline";

    var variantsNode = root.querySelector("[data-stockpulse-variants]");
    var variants = [];
    if (variantsNode) {
      try {
        variants = JSON.parse(variantsNode.textContent || "[]");
      } catch (_err) {
        variants = [];
      }
    }

    var currentVariantId = root.dataset.variantId || "";
    var variantLabelEl = root.querySelector("[data-sp-variant-title]");
    var form = root.querySelector("[data-sp-form]");
    var emailInput = root.querySelector("[data-sp-email]");
    var submitBtn = root.querySelector("[data-sp-submit]");
    var feedbackEl = root.querySelector("[data-sp-feedback]");
    var modalTrigger = root.querySelector("[data-sp-modal-open]");
    var modalBackdrop = root.querySelector("[data-sp-modal-backdrop]");
    var modalClose = root.querySelector("[data-sp-modal-close]");

    function findVariant(id) {
      var strId = String(id || "");
      for (var i = 0; i < variants.length; i++) {
        if (String(variants[i].id) === strId) return variants[i];
      }
      return null;
    }

    function setFeedback(message, type) {
      if (!feedbackEl) return;
      feedbackEl.textContent = message || "";
      feedbackEl.classList.remove(
        "stockpulse-feedback--success",
        "stockpulse-feedback--error"
      );
      if (type === "success") {
        feedbackEl.classList.add("stockpulse-feedback--success");
      } else if (type === "error") {
        feedbackEl.classList.add("stockpulse-feedback--error");
      }
    }

    function updateVariantState(variantId) {
      if (!variantId) return;
      currentVariantId = String(variantId);
      root.dataset.variantId = currentVariantId;
      var variant = findVariant(currentVariantId);
      if (!variant) return;

      if (variant.available) {
        root.setAttribute("hidden", "");
      } else {
        root.removeAttribute("hidden");
      }

      if (variantLabelEl) {
        if (variant.title && variant.title !== "Default Title") {
          variantLabelEl.textContent = "Variant: " + variant.title;
          variantLabelEl.removeAttribute("hidden");
        } else {
          variantLabelEl.textContent = "";
          variantLabelEl.setAttribute("hidden", "");
        }
      }

      setFeedback("", "");
    }

    // Hydrate merchant-configured button styles from App Proxy if available
    if (shop) {
      fetch(settingsEndpoint + "?shop=" + encodeURIComponent(shop), {
        method: "GET",
        headers: { Accept: "application/json" },
      })
        .then(function (res) {
          return res.ok ? res.json() : null;
        })
        .then(function (data) {
          if (!data || !data.settings) return;
          if (data.settings.buttonColor) {
            root.style.setProperty("--sp-btn-bg", data.settings.buttonColor);
          }
          if (data.settings.buttonText) {
            if (modalTrigger) {
              modalTrigger.textContent = data.settings.buttonText;
            } else if (submitBtn) {
              submitBtn.textContent = data.settings.buttonText;
            }
          }
        })
        .catch(function () {
          // Non-fatal: keep Liquid defaults
        });
    }

    if (displayMode === "modal" && modalTrigger && modalBackdrop) {
      modalTrigger.addEventListener("click", function () {
        modalBackdrop.removeAttribute("hidden");
        if (emailInput) emailInput.focus();
      });
      if (modalClose) {
        modalClose.addEventListener("click", function () {
          modalBackdrop.setAttribute("hidden", "");
        });
      }
      modalBackdrop.addEventListener("click", function (e) {
        if (e.target === modalBackdrop) {
          modalBackdrop.setAttribute("hidden", "");
        }
      });
    }

    if (form && emailInput && submitBtn) {
      var originalLabel = submitBtn.textContent;
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        var email = (emailInput.value || "").trim();
        if (!EMAIL_RE.test(email)) {
          setFeedback(
            root.dataset.invalidEmail || "Please enter a valid email address.",
            "error"
          );
          return;
        }

        var variant = findVariant(currentVariantId) || {};
        submitBtn.disabled = true;
        submitBtn.textContent =
          root.dataset.submittingText || "Joining waitlist...";
        setFeedback("", "");

        fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            shop: shop,
            productId: productId,
            variantId: currentVariantId,
            productTitle: productTitle,
            variantTitle: variant.title || null,
            productHandle: productHandle || null,
            variantPrice:
              typeof variant.price === "number" ? variant.price : null,
            email: email,
          }),
        })
          .then(function (res) {
            return res.json().then(function (body) {
              return { ok: res.ok, body: body };
            });
          })
          .then(function (result) {
            if (result.ok && result.body && result.body.success) {
              setFeedback(
                result.body.message ||
                  root.dataset.successText ||
                  "We'll notify you the moment it restocks!",
                "success"
              );
              emailInput.value = "";
            } else {
              setFeedback(
                (result.body && result.body.error) ||
                  root.dataset.errorText ||
                  "Something went wrong. Please try again.",
                "error"
              );
            }
          })
          .catch(function () {
            setFeedback(
              root.dataset.errorText ||
                "Something went wrong. Please try again.",
              "error"
            );
          })
          .finally(function () {
            submitBtn.disabled = false;
            submitBtn.textContent = originalLabel;
          });
      });
    }

    // Watch Shopify theme variant selectors and URL ?variant= updates
    document.addEventListener("change", function (event) {
      var target = event.target;
      if (
        target &&
        (target.name === "id" || target.getAttribute("data-variant-id"))
      ) {
        var nextId = target.value || target.getAttribute("data-variant-id");
        if (nextId) updateVariantState(nextId);
      }
    });

    document.addEventListener("variant:change", function (event) {
      if (event && event.detail && event.detail.variant) {
        updateVariantState(event.detail.variant.id);
      }
    });

    var lastHref = window.location.href;
    window.setInterval(function () {
      if (window.location.href !== lastHref) {
        lastHref = window.location.href;
        var params = new URLSearchParams(window.location.search);
        var v = params.get("variant");
        if (v && v !== currentVariantId) {
          updateVariantState(v);
        }
      }
    }, 350);
  }

  function boot() {
    var nodes = document.querySelectorAll("[data-stockpulse-root]");
    for (var i = 0; i < nodes.length; i++) {
      initWidget(nodes[i]);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
