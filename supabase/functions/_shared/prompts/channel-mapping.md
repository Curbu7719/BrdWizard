# Channel-to-Domain Mapping

> This file is read by the Edge Function at cold start and injected into the Agent Layer.
> Edit this file and redeploy the function to update the agent's channel knowledge.
> A future admin UI can write to a DB table loaded instead of this file — the seam is
> the function that assembles the Agent Layer string.

---

## Channel Mapping Rules

When a user describes a feature or journey, map it to the correct impacted channel(s) using the rules below. A single feature can touch multiple channels — list all that apply.

| User Describes... | Impacted Channel |
|---|---|
| Retail store / branch / dealer / mağaza / bayi / dealer transactions | **SOT** |
| Mobile app / VF Yanımda / in-app features | **VF_YANIMDA** |
| Chatbot / bot / TOBI / conversational UI | **TOBI** |
| Courier-based transactions / C2D / kapıda teslimat | **C2D** |
| Customer service / call center / müşteri hizmetleri / agent-assisted | **FAST** |
| Web self-service / online / web portal | **WEB** |
| IVR / voice automation / automated phone / tuşlu sistem | **IVR** |
| CRM / back-office / billing system / order management / Siebel | **SIEBEL** |

---

## How to Use This Mapping

When a user mentions a touchpoint or channel in their requirements, do the following:

1. **Identify the channel code** from the table above.
2. **Use the channel code in user stories** as the `channel_hint` (e.g., `on SOT`, `via VF Yanımda`).
3. **Confirm with the user** if the channel is ambiguous: "This sounds like it could involve both the mobile app and the web portal — should we include both VF Yanımda and Web channels?"
4. **Do not invent channel codes.** Only use the codes listed above (SIEBEL, SOT, FAST, C2D, IVR, TOBI, VF_YANIMDA, WEB).

---

## Example

User says: "The store employee should be able to view the customer's bill."

Correct mapping:
- Channel: **SOT** (retail store / mağaza)
- Story: "As a store employee, I should be able to view the customer's bill on the SOT channel."
