document.addEventListener("DOMContentLoaded", function () {
    // Chat elements
    const chatBox = document.getElementById('chat-box');
    const userInput = document.getElementById('user-input');
    const sendBtn = document.getElementById('send-btn');
    const micBtn = document.getElementById('mic-btn');
    const clearBtn = document.getElementById('clear-btn');
    const helpBtn = document.getElementById('help-btn');
    const stopSpeakBtn = document.getElementById('stop-speak-btn'); // NEW

    // Cart elements
    const cartBtn = document.getElementById('cart-float-btn');
    const cartSidebar = document.getElementById('cart-sidebar');
    const cartOverlay = document.getElementById('cart-overlay');
    const cartCloseBtn = document.getElementById('cart-close-btn');
    const cartItemsDiv = document.getElementById('cart-items');
    const cartCheckoutBtn = document.getElementById('cart-checkout-btn');
    const cartCount = document.getElementById('cart-count');
    const cartTotal = document.getElementById('cart-total');

    // State
    let currentResults = [];
    let currentIndex = 0;
    let cart = [];
    let orderingBlouse = null;
    let orderStep = 0;
    let orderData = { name: "", phone: "", address: "" };
    let listening = false;
    let recognition = null;

    // --- Chat & Voice ---

    function appendMessage(content, sender = 'bot', speakType = "default", item = null) {
        const div = document.createElement('div');
        div.className = 'message ' + sender;
        div.innerHTML = content;
        chatBox.appendChild(div);
        chatBox.scrollTop = chatBox.scrollHeight;
        if (sender === 'bot') speak(content.replace(/<[^>]+>/g, ''), speakType, item);
    }

    // --- Voice Output (Speak) ---
    function speak(text, type = "default", item = null) {
        if (!window.speechSynthesis) return;
        window.speechSynthesis.cancel(); // Always stop previous speech

        let toSpeak = text;
        if (type === "suggestion" && item) {
            toSpeak = `${item.title}. Price: ₹${item.price_inr || 'N/A'}. ID: ${item.design_id}.`;
        }
        // Only speak if not empty
        if (toSpeak.trim()) {
            const utter = new window.SpeechSynthesisUtterance(toSpeak);
            window.speechSynthesis.speak(utter);
        }
    }

    // Stop speaking on button click
    if (stopSpeakBtn) {
        stopSpeakBtn.onclick = function() {
            if (window.speechSynthesis) window.speechSynthesis.cancel();
        };
    }

    async function sendMessage() {
        const msg = userInput.value.trim();
        if (!msg) return;

        // Order flow
        if (orderingBlouse) {
            handleOrderInput(msg);
            userInput.value = '';
            return;
        }

        // Voice cart commands
        if (msg.toLowerCase().includes('open cart')) {
            openCart();
            userInput.value = '';
            return;
        }
        if (msg.toLowerCase().includes('checkout')) {
            openCart();
            setTimeout(() => startCheckout(), 200);
            userInput.value = '';
            return;
        }
        if (msg.toLowerCase().startsWith('remove')) {
            removeFromCartByVoice(msg);
            userInput.value = '';
            return;
        }

        appendMessage(msg, 'user');
        userInput.value = '';
        sendBtn.disabled = true;
        micBtn.disabled = true;

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: msg })
            });
            const data = await response.json();

            if (data.results?.length > 0) {
                currentResults = data.results;
                currentIndex = 0;
                showSingleSuggestion(currentResults[currentIndex]);
            } else {
                appendMessage(data.message || "No matching blouses found.", 'bot');
            }
        } catch (error) {
            appendMessage('Sorry, there was an error. Please try again.', 'bot');
        } finally {
            sendBtn.disabled = false;
            micBtn.disabled = false;
        }
    }

    function showSingleSuggestion(item) {
        const html = `
            <div class="suggestion-card">
                <div style="display:flex;align-items:center;gap:14px;">
                    ${item.front_image_url ? `<img src="${item.front_image_url}" alt="${item.title}" style="max-width:90px;max-height:90px;border-radius:10px;">` : ''}
                    <div>
                        <h3 style="margin:0 0 6px 0;">${item.title}</h3>
                        <div style="font-size:0.97rem;color:#64748b;">ID: ${item.design_id}</div>
                        <div style="font-size:1.08rem;color:#2563eb;font-weight:600;">₹${item.price_inr || 'N/A'}</div>
                    </div>
                </div>
                <div style="margin:10px 0 0 0;">
                    <b>Fabric:</b> ${Array.isArray(item.fabric) ? item.fabric.join(', ') : item.fabric || 'N/A'}<br>
                    <b>Neckline:</b> ${item.neckline || 'N/A'}<br>
                    <b>Sleeve:</b> ${item.sleeve || 'N/A'}<br>
                    <b>Occasion:</b> ${Array.isArray(item.occasion_tags) ? item.occasion_tags.join(', ') : 'N/A'}<br>
                    ${item.color ? `<b>Color:</b> ${item.color}<br>` : ''}
                    ${item.size ? `<b>Size:</b> ${item.size}<br>` : ''}
                    ${item.description ? `<b>Description:</b> ${item.description}<br>` : ''}
                </div>
                <div style="margin-top:12px;">
                    <button class="send-btn add-cart-btn" data-index="${currentIndex}" style="margin-right:10px;">Add to Cart</button>
                    <button class="send-btn buy-now-btn" data-index="${currentIndex}" style="margin-right:10px;">Buy Now</button>
                    <button class="send-btn next-btn" data-index="${currentIndex}">Next Option</button>
                </div>
            </div>
        `;
        appendMessage(html, 'bot', "suggestion", item);
        setTimeout(() => {
            document.querySelector(`.add-cart-btn[data-index="${currentIndex}"]`).onclick = () => addToCart(currentResults[currentIndex]);
            document.querySelector(`.buy-now-btn[data-index="${currentIndex}"]`).onclick = () => startOrderProcess(currentResults[currentIndex]);
            document.querySelector(`.next-btn[data-index="${currentIndex}"]`).onclick = showNextSuggestion;
        }, 100);
    }

    function startOrderProcess(item) {
        orderingBlouse = item;
        orderStep = 1;
        orderData = { name: "", phone: "", address: "" };
        appendMessage("Great! Let's place your order. What's your full name?", 'bot');
    }

    function addToCart(item) {
        if (!cart.find(b => b.design_id === item.design_id)) {
            cart.push(item);
            updateCartCount();
            appendMessage(`✅ <b>${item.title}</b> added to cart! 🛒`, 'bot');
        } else {
            appendMessage(`ℹ️ <b>${item.title}</b> is already in your cart.`, 'bot');
        }
    }

    function showNextSuggestion() {
        currentIndex++;
        if (currentIndex < currentResults.length) {
            showSingleSuggestion(currentResults[currentIndex]);
        } else {
            appendMessage("No more suggestions available. Try a new search!", 'bot');
            resetOrderState();
        }
    }

    async function handleOrderInput(input) {
        appendMessage(input, 'user');
        switch(orderStep) {
            case 1:
                orderData.name = input;
                orderStep = 2;
                appendMessage("Thank you! Please provide your phone number.", 'bot');
                break;
            case 2:
                orderData.phone = input;
                orderStep = 3;
                appendMessage("Finally, please provide your delivery address.", 'bot');
                break;
            case 3:
                orderData.address = input;
                await submitOrder();
                break;
        }
    }

    // --- MULTIPLE PRODUCTS CHECKOUT ---
    async function submitOrder() {
        appendMessage("Processing your order...", 'bot');
        try {
            // If checking out from cart, send all products
            let productsToOrder = [];
            if (checkoutQueue && checkoutQueue.length > 0) {
                productsToOrder = [orderingBlouse, ...checkoutQueue];
            } else if (orderingBlouse) {
                productsToOrder = [orderingBlouse];
            }

            const response = await fetch('/api/place_order', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: orderData.name,
                    phone: orderData.phone,
                    address: orderData.address,
                    products: productsToOrder
                })
            });
            const data = await response.json();
            if (data.success) {
                appendMessage(`✅ Order placed for <b>${productsToOrder.length}</b> product(s)!<br>Total Amount: <b>₹${data.total_amount}</b><br>Thank you ${orderData.name}. We'll contact you at ${orderData.phone}.`, 'bot');
                // Remove all ordered products from cart
                productsToOrder.forEach(prod => {
                    cart = cart.filter(b => b.design_id !== prod.design_id);
                });
                updateCartCount();
                renderCart();
            } else {
                appendMessage(`❌ Order failed: ${data.message}`, 'bot');
            }
        } catch (error) {
            appendMessage("⚠️ Error processing order. Please try again.", 'bot');
        }
        resetOrderState();
    }

    function resetOrderState() {
        currentResults = [];
        currentIndex = 0;
        orderingBlouse = null;
        orderStep = 0;
        orderData = { name: "", phone: "", address: "" };
        checkoutQueue = [];
    }

    // --- Cart UI ---

    function updateCartCount() {
        cartCount.textContent = cart.length;
    }

    function openCart() {
        renderCart();
        cartSidebar.classList.add('open');
        cartOverlay.classList.add('open');
    }
    function closeCart() {
        cartSidebar.classList.remove('open');
        cartOverlay.classList.remove('open');
    }

    function renderCart() {
        cartItemsDiv.innerHTML = '';
        if (cart.length === 0) {
            cartItemsDiv.innerHTML = '<div style="text-align:center;color:#64748b;">Your cart is empty.</div>';
            cartTotal.textContent = "0";
        } else {
            let total = 0;
            cart.forEach((item, idx) => {
                total += parseInt(item.price_inr || 0);
                const div = document.createElement('div');
                div.className = 'cart-item';
                div.innerHTML = `
                    ${item.front_image_url ? `<img src="${item.front_image_url}" alt="${item.title}">` : ''}
                    <div class="cart-item-details">
                        <div class="cart-item-title">${item.title}</div>
                        <div style="font-size:0.96rem;color:#64748b;">₹${item.price_inr || 'N/A'} | ID: ${item.design_id}</div>
                    </div>
                    <button class="cart-item-remove" data-idx="${idx}">Remove</button>
                `;
                cartItemsDiv.appendChild(div);
            });
            cartTotal.textContent = total;
            document.querySelectorAll('.cart-item-remove').forEach(btn => {
                btn.onclick = function() {
                    const idx = parseInt(this.getAttribute('data-idx'));
                    cart.splice(idx, 1);
                    updateCartCount();
                    renderCart();
                };
            });
        }
    }

    function startCheckout() {
        if (cart.length === 0) {
            appendMessage("Your cart is empty! Add something first.", 'bot');
            closeCart();
            return;
        }
        // Place order for all cart items at once
        checkoutQueue = cart.slice(1); // All except the first
        orderingBlouse = cart[0];
        orderStep = 1;
        orderData = { name: "", phone: "", address: "" };
        closeCart();
        appendMessage(
            `Ready to checkout <b>${cart.length}</b> product(s).<br>
            <b>Total Amount: ₹${cart.reduce((sum, item) => sum + (parseInt(item.price_inr) || 0), 0)}</b><br>
            What's your full name?`, 'bot'
        );
    }

    function removeFromCart(idx) {
        if (cart[idx]) {
            appendMessage(`<b>${cart[idx].title}</b> removed from cart.`, 'bot');
            cart.splice(idx, 1);
            updateCartCount();
            renderCart();
        }
    }

    function removeFromCartByVoice(msg) {
        let found = false;
        cart.forEach((item, idx) => {
            if (msg.toLowerCase().includes(item.title.toLowerCase()) || msg.toLowerCase().includes((idx+1).toString())) {
                removeFromCart(idx);
                found = true;
            }
        });
        if (!found) appendMessage("Say the product name or number to remove from cart.", 'bot');
    }

    // --- Voice Input ---

    function setupVoiceRecognition() {
        if ('webkitSpeechRecognition' in window) {
            recognition = new webkitSpeechRecognition();
            recognition.continuous = false;
            recognition.interimResults = false;
            recognition.lang = 'en-US';

            recognition.onresult = (event) => {
                const transcript = event.results[0][0].transcript.toLowerCase();
                userInput.value = transcript;

                if (transcript.includes('open cart')) {
                    openCart();
                    userInput.value = '';
                    return;
                }
                if (transcript.includes('checkout')) {
                    openCart();
                    setTimeout(() => startCheckout(), 200);
                    userInput.value = '';
                    return;
                }
                if (transcript.startsWith('remove')) {
                    removeFromCartByVoice(transcript);
                    userInput.value = '';
                    return;
                }
                if (orderingBlouse) {
                    if (transcript.startsWith('my name is')) {
                        handleOrderInput(transcript.replace('my name is', '').trim());
                        userInput.value = '';
                        return;
                    }
                    if (transcript.startsWith('my phone is')) {
                        handleOrderInput(transcript.replace('my phone is', '').trim());
                        userInput.value = '';
                        return;
                    }
                    if (transcript.startsWith('my address is')) {
                        handleOrderInput(transcript.replace('my address is', '').trim());
                        userInput.value = '';
                        return;
                    }
                    handleOrderInput(transcript);
                    userInput.value = '';
                    return;
                }
                if (transcript.includes('add to cart')) {
                    if (currentResults.length > 0 && currentIndex < currentResults.length) {
                        addToCart(currentResults[currentIndex]);
                        userInput.value = '';
                        return;
                    }
                }
                if (transcript.includes('buy now')) {
                    if (currentResults.length > 0 && currentIndex < currentResults.length) {
                        startOrderProcess(currentResults[currentIndex]);
                        userInput.value = '';
                        return;
                    }
                }
                if (transcript.includes('next')) {
                    showNextSuggestion();
                    userInput.value = '';
                    return;
                }
                sendMessage();
            };

            recognition.onend = () => {
                micBtn.textContent = '🎤';
                listening = false;
            };

            micBtn.onclick = () => {
                if (listening) {
                    recognition.stop();
                } else {
                    recognition.start();
                    micBtn.textContent = '⏹️';
                    listening = true;
                }
            };
        } else {
            micBtn.style.display = 'none';
        }
    }

    // --- Voice Command Help ---
    helpBtn.onclick = function() {
        appendMessage(`
            <b>🎤 Voice Commands You Can Say:</b>
            <ul>
                <li><b>Show me cotton blouses</b></li>
                <li><b>Add to cart</b></li>
                <li><b>Buy now</b></li>
                <li><b>Next option</b></li>
                <li><b>Open cart</b></li>
                <li><b>Remove from cart</b></li>
                <li><b>Checkout</b></li>
                <li><b>My name is ...</b> (during checkout)</li>
                <li><b>My phone is ...</b> (during checkout)</li>
                <li><b>My address is ...</b> (during checkout)</li>
            </ul>
        `, 'bot');
    };

    // --- Cart UI Events ---
    cartBtn.onclick = openCart;
    cartCloseBtn.onclick = closeCart;
    cartOverlay.onclick = closeCart;
    cartCheckoutBtn.onclick = startCheckout;

    // --- Chat Events ---
    clearBtn.onclick = () => {
        chatBox.innerHTML = '';
        appendMessage("Hi! I'm Fashionous BlouseBot. How can I assist you today?", 'bot');
        resetOrderState();
    };

    document.getElementById('chat-form').onsubmit = (e) => {
        e.preventDefault();
        sendMessage();
    };

    userInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // --- Init ---
    setupVoiceRecognition();
    appendMessage("👋 Hi! I'm Fashionous BlouseBot. You can search, add to cart, buy, or checkout using text or voice! Click ❓ for voice help.", 'bot');
    updateCartCount();
});
