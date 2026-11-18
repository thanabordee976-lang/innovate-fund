"use strict";

const contractAddress = "0x1dC1f3f21Fec0dCe21DFc009F9449363a5E3e215";
// Deploy InnovateFundDetails with the existing fund address, then set its address here.
const DETAILS_CONTRACT = "0x09500D8Fc121d3a1017a81d3598de5C7d2B0999e";
const DETAILS_ABI = [
  "function fund() view returns (address)",
  "function setDetails(uint256 id,string category,string team,string story,string coverUrl)",
  "function publishUpdate(uint256 id,string title,string body,string evidenceUrl)",
  "function getDetails(uint256 id) view returns ((string category,string team,string story,string coverUrl) info,uint256 updateCount)",
  "function getUpdates(uint256 id,uint256 offset,uint256 limit) view returns ((string title,string body,string evidenceUrl,uint64 publishedAt)[])",
];
const CATEGORIES = {
  education: "การศึกษา",
  environment: "สิ่งแวดล้อม",
  technology: "เทคโนโลยี",
  community: "ชุมชนและสังคม",
};
const RPC_URL = "https://ethereum-sepolia-rpc.publicnode.com";
const CHAIN_ID = "0xaa36a7";
const PAGE = 8n;
const ABI = [
  "event CampaignCreated(uint256 indexed id, address indexed owner)",
  "function campaignCount() view returns (uint256)",
  "function createCampaign(string title, uint256 goal, uint64 deadline, (string title,string description,uint256 amount)[] plan) returns (uint256)",
  "function contribute(uint256 id) payable",
  "function requestRelease(uint256 id, uint256 index, uint256 previousRound, string evidence)",
  "function vote(uint256 id, uint256 index, uint256 round, bool approve)",
  "function release(uint256 id, uint256 index)",
  "function refund(uint256 id)",
  "function contributions(uint256 id, address) view returns (uint256)",
  "function votedInRound(uint256 id, uint256 index, address account) view returns (uint256)",
  "function getCampaign(uint256 id) view returns ((address owner,string title,uint256 goal,uint64 deadline,uint256 raised,uint256 paid,uint256 refunded,uint256 nextMilestone) campaign,uint256 milestoneCount,uint256 entryCount)",
  "function getMilestones(uint256 id) view returns ((string title,string description,uint256 amount,string evidence,uint256 round,uint256 yes,uint256 no,uint8 stage)[])",
  "function getLedger(uint256 id,uint256 offset,uint256 limit) view returns ((uint8 kind,address account,uint256 amount,uint64 recordedAt,uint256 milestone)[])",
];
const STAGES = [
  "รอส่งหลักฐาน",
  "กำลังลงคะแนน",
  "อนุมัติแล้ว",
  "จ่ายแล้ว",
  "ไม่ผ่าน",
];
const MOVEMENTS = ["เงินสนับสนุน", "จ่ายตาม Milestone", "คืนเงิน"];
const explorer = "https://sepolia.etherscan.io";
const dateFormat = new Intl.DateTimeFormat("th-TH", {
  dateStyle: "medium",
  timeStyle: "short",
});
const $ = (id) => document.getElementById(id);
let provider;
let signer;
let wallet;
let walletRevision = 0;
let view;
let viewRevision = 0;
let listRevision = 0;
let nextCampaign = 0n;
let catalogMode = "discover";
let busy = false;
let createStep = 0;

function campaignCard(
  id,
  campaign,
  contribution,
  refunded = false,
  info = null,
) {
  const card = node("article", "", "project-card");
  const media = node("div", "", "project-card-media abstract");
  const symbol = node("strong", "IF");
  symbol.setAttribute("aria-hidden", "true");
  media.append(symbol);
  try {
    const url = optionalHttps(info?.coverUrl || "");
    if (url) {
      const image = document.createElement("img");
      image.src = url;
      image.alt = "รูปปกโครงการ " + campaign.title;
      image.loading = "lazy";
      image.referrerPolicy = "no-referrer";
      image.onerror = () => image.remove();
      media.append(image);
    }
  } catch {}
  const body = node("div", "", "project-card-body");
  const labels = {
    funding: "เปิดรับทุน",
    funded: "ถึงเป้าแล้ว",
    complete: "ส่งมอบครบแล้ว",
    failed: "ปิดระดมทุน",
  };
  const status = phase(campaign);
  const meta = node("div", "", "spread");
  meta.append(
    node("span", "โครงการ #" + id, "eyebrow"),
    badge(labels[status], status === "failed" ? "bad" : "good"),
  );
  body.append(meta, node("h3", campaign.title));
  if (info?.category)
    body.append(node("p", CATEGORIES[info.category] || info.category, "muted"));
  if (contribution > 0n)
    body.append(
      node(
        "p",
        "คุณสนับสนุน " + eth(contribution) + (refunded ? " · คืนเงินแล้ว" : ""),
        "muted",
      ),
    );
  const amounts = node("div", "", "spread");
  amounts.append(
    node("strong", eth(campaign.raised)),
    node("span", "จาก " + eth(campaign.goal), "muted"),
  );
  const progress = document.createElement("progress");
  progress.max = 100;
  progress.value = Number((campaign.raised * 10000n) / campaign.goal) / 100;
  progress.setAttribute("aria-label", "ความคืบหน้าของ " + campaign.title);
  const details = node("div", "", "card-bottom");
  const remainingDays = Math.ceil(
    (Number(campaign.deadline) - Date.now() / 1000) / 86400,
  );
  details.append(
    node("span", Math.round(progress.value) + "% ของเป้าหมาย"),
    node(
      "span",
      status === "funding"
        ? "เหลือ " + Math.max(0, remainingDays) + " วัน"
        : labels[status],
    ),
  );
  body.append(
    amounts,
    progress,
    details,
    actionButton("ดูโครงการ ↗", "secondary", () => openCampaign(id)),
  );
  card.append(media, body);
  return card;
}

function showCatalog(mode = catalogMode) {
  catalogMode = mode;
  ++viewRevision;
  $("detail-panel").hidden = true;
  $("catalog").hidden = false;
  $("hero").hidden = mode === "mine";
  $("catalog-title").textContent =
    mode === "mine" ? "โครงการที่คุณร่วมสร้าง" : "ร่วมสร้างสิ่งดี ๆ ไปด้วยกัน";
  $("catalog-eyebrow").textContent =
    mode === "mine" ? "YOUR CONTRIBUTIONS" : "FIND A PROJECT TO SUPPORT";
  for (const [id, active] of [
    ["discover-nav", mode === "discover"],
    ["mine-nav", mode === "mine"],
  ]) {
    $(id).classList.toggle("active", active);
    $(id).setAttribute("aria-pressed", String(active));
  }
  notify("lookup-notice");
  listCampaigns(true);
}

async function pastContribution(contract, id, account, campaign, count, stake) {
  if (stake > 0n || phase(campaign) !== "failed" || campaign.refunded === 0n)
    return { total: stake, refunded: false };
  let total = 0n;
  for (let offset = 0n; offset < count; offset += 20n) {
    const entries = await contract.getLedger(id, offset, 20);
    for (const entry of entries) {
      if (
        Number(entry.kind) === 0 &&
        entry.account.toLowerCase() === account.toLowerCase()
      )
        total += entry.amount;
    }
  }
  return { total, refunded: total > 0n };
}

function node(tag, text, className) {
  const item = document.createElement(tag);
  item.textContent = text;
  if (className) item.className = className;
  return item;
}

function notify(id, text = "", error = false) {
  const item = $(id);
  item.textContent = text;
  item.hidden = !text;
  item.classList.toggle("error", error);
}

function explain(error) {
  if (error.code === "ACTION_REJECTED" || error.code === 4001)
    return "ยกเลิกรายการใน MetaMask";
  return (
    error.reason ||
    error.info?.error?.data?.reason ||
    error.shortMessage ||
    error.message
  );
}

function contractAt(address, runner) {
  if (!window.ethers) throw new Error("โหลดไลบรารีกระเป๋าไม่สำเร็จ");
  if (!address) throw new Error("ตั้งค่าที่อยู่สัญญาก่อน");
  if (!runner) {
    provider ??= new ethers.JsonRpcProvider(RPC_URL, 11155111, {
      batchMaxCount: 1,
    });
    runner = provider;
  }
  return new ethers.Contract(ethers.getAddress(address), ABI, runner);
}

function optionalHttps(value) {
  const raw = value.trim();
  if (!raw) return "";
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    new TextEncoder().encode(url.href).length > 500
  ) {
    throw new Error("ใช้ลิงก์ HTTPS ความยาวไม่เกิน 500 ไบต์");
  }
  return url.href;
}

function projectDetails(form, optional = false) {
  const values = form.elements;
  if (
    optional &&
    ![values.team.value, values.story.value, values.coverUrl.value].some(
      (value) => value.trim(),
    )
  )
    return null;
  if (!CATEGORIES[values.category.value])
    throw new Error("เลือกหมวดหมู่โครงการ");
  return {
    category: values.category.value,
    team: textValue(values.team.value, "ชื่อทีม", 160),
    story: textValue(values.story.value, "เรื่องราวโครงการ", 2400),
    coverUrl: optionalHttps(values.coverUrl.value),
  };
}

function detailsDraftKey(id, owner) {
  return (
    "innovatefund-details:" +
    CHAIN_ID +
    ":" +
    contractAddress.toLowerCase() +
    ":" +
    id +
    ":" +
    owner.toLowerCase()
  );
}

function getDetailsDraft(id, owner) {
  try {
    return JSON.parse(
      sessionStorage.getItem(detailsDraftKey(id, owner)) || "null",
    );
  } catch {
    return null;
  }
}

async function detailsContract(runner) {
  if (!DETAILS_CONTRACT)
    throw new Error(
      "ต้องตั้งค่าสัญญาข้อมูลโครงการก่อนบันทึกรายละเอียดและรายงาน",
    );
  const base = contractAt(contractAddress, runner);
  const contract = new ethers.Contract(
    ethers.getAddress(DETAILS_CONTRACT),
    DETAILS_ABI,
    base.runner,
  );
  if ((await contract.fund()).toLowerCase() !== contractAddress.toLowerCase()) {
    throw new Error("สัญญาข้อมูลโครงการไม่ได้ผูกกับสัญญาระดมทุนนี้");
  }
  return contract;
}

async function readContent(id) {
  if (!DETAILS_CONTRACT)
    return {
      configured: false,
      info: null,
      updates: [],
      count: 0n,
      offset: 0n,
    };
  try {
    const contract = await detailsContract();
    const [info, count] = await contract.getDetails(id);
    const offset = count > PAGE ? count - PAGE : 0n;
    const updates =
      count > 0n ? await contract.getUpdates(id, offset, count - offset) : [];
    return { configured: true, contract, info, count, offset, updates };
  } catch (error) {
    return {
      configured: true,
      info: null,
      updates: [],
      count: 0n,
      offset: 0n,
      error: explain(error),
    };
  }
}

function appendUpdates(entries) {
  for (const entry of Array.from(entries).reverse()) {
    const article = node("article", "", "project-update");
    article.append(
      node("h3", entry.title),
      node("p", date(entry.publishedAt), "muted"),
      node("p", entry.body, "report-body"),
    );
    let url;
    try {
      url = optionalHttps(entry.evidenceUrl);
    } catch {}
    if (url) {
      const link = node("a", "เปิดรูปหรือหลักฐาน ↗");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      article.append(link);
    }
    $("updates-list").append(article);
  }
}

function renderContent(current) {
  const content = current.content;
  const owner = wallet?.toLowerCase() === current.campaign.owner.toLowerCase();
  const info = content.info;
  $("project-category").textContent =
    CATEGORIES[info?.category] || info?.category || "";
  $("project-category").hidden = !info?.category;
  $("project-team").textContent = info?.team ? "ทีมงาน · " + info.team : "";
  $("project-story").textContent =
    info?.story || "ยังไม่มีเรื่องราวเพิ่มเติมจากเจ้าของโครงการ";
  const cover = $("project-cover");
  cover.hidden = true;
  cover.removeAttribute("src");
  let imageUrl;
  try {
    imageUrl = optionalHttps(info?.coverUrl || "");
  } catch {}
  if (imageUrl) {
    cover.hidden = false;
    cover.src = imageUrl;
    cover.alt = "รูปปกโครงการ " + current.campaign.title;
  }
  $("details-editor").hidden = !owner;
  $("details-editor").open = false;
  $("update-form").hidden = !owner;
  $("update-form").reset();
  const ready = content.configured && !content.error;
  $("save-details").disabled = !ready;
  $("publish-update").disabled = !ready;
  notify(
    "details-read-notice",
    content.error ||
      (owner && !content.configured
        ? "รายละเอียดเพิ่มเติมและรายงานจะเปิดให้บันทึกหลังตั้งค่าสัญญาข้อมูลโครงการ"
        : ""),
    !!content.error,
  );
  notify("details-notice");
  notify("update-notice");
  if (owner) {
    const draft = getDetailsDraft(current.id, current.campaign.owner);
    const values = draft || info || {};
    for (const key of ["category", "team", "story", "coverUrl"]) {
      $("details-form").elements[key].value =
        values[key] || (key === "category" ? "education" : "");
    }
    if (draft) {
      $("details-editor").open = true;
      notify(
        "details-notice",
        "รายละเอียดนี้ยังเป็นฉบับร่าง กดบันทึกเพื่อเผยแพร่ให้ทุกคนเห็น",
      );
    }
  }
  $("updates-list").replaceChildren();
  if (content.count === 0n)
    $("updates-list").append(node("p", "ยังไม่มีรายงานความคืบหน้า", "muted"));
  else appendUpdates(content.updates);
  $("updates-count").textContent = content.count + " รายงาน";
  $("more-updates").hidden = content.offset === 0n;
}

async function sendContent(current, notice, action, after) {
  if (
    current !== view ||
    wallet?.toLowerCase() !== current.campaign.owner.toLowerCase()
  )
    return;
  return send(
    notice,
    async (base) => {
      const contract = await detailsContract(base.runner);
      return action(contract);
    },
    async () => {
      await after?.();
      if (current === view) await openCampaign(current.id, false);
      await listCampaigns(true);
    },
  );
}

function textValue(value, label, limit) {
  const text = value.trim();
  if (!text || new TextEncoder().encode(text).length > limit)
    throw new Error(label + " ต้องมี 1–" + limit + " ไบต์");
  return text;
}

function amount(value) {
  const raw = value.trim();
  if (!/^\d+(\.\d{1,18})?$/.test(raw))
    throw new Error("กรอกยอด ETH ที่ถูกต้อง");
  const wei = ethers.parseEther(raw);
  if (wei <= 0n) throw new Error("ยอด ETH ต้องมากกว่า 0");
  return wei;
}

const eth = (wei) => ethers.formatEther(wei) + " ETH";
const date = (time) => dateFormat.format(new Date(Number(time) * 1000));
const short = (address) => address.slice(0, 6) + "…" + address.slice(-4);

function phase(campaign) {
  if (campaign.raised === campaign.goal)
    return campaign.paid === campaign.goal ? "complete" : "funded";
  return BigInt(Math.floor(Date.now() / 1000)) < campaign.deadline
    ? "funding"
    : "failed";
}

function badge(label, tone) {
  return node("span", label, "badge" + (tone ? " " + tone : ""));
}

function metrics(items) {
  $("metrics").replaceChildren(
    ...items.map(([key, value]) => {
      const row = document.createElement("div");
      row.append(node("dt", key), node("dd", eth(value)));
      return row;
    }),
  );
}

function updateFunding() {
  if (!view) return;
  const { campaign, stake } = view;
  const current = phase(campaign);
  const labels = {
    funding: "กำลังระดมทุน",
    funded: "ถึงเป้าหมาย",
    complete: "จ่ายครบแล้ว",
    failed: "ไม่ถึงเป้าหมาย",
  };
  const status = $("campaign-status");
  status.textContent = labels[current];
  status.classList.toggle("bad", current === "failed");
  status.classList.toggle(
    "good",
    current === "funded" || current === "complete",
  );
  const seconds = Math.max(
    0,
    Number(campaign.deadline) - Math.floor(Date.now() / 1000),
  );
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  $("countdown").textContent =
    current === "funding"
      ? "เหลือ " +
        (days ? days + " วัน " : "") +
        hours +
        " ชม. " +
        minutes +
        " นาที"
      : "ปิดรับเงินทุน";
  const owner = wallet === campaign.owner;
  $("funding-actions").hidden = false;
  $("contribute-form").hidden = current !== "funding" || owner;
  $("refund-button").hidden = current !== "failed" || stake === 0n;
  $("your-funds").textContent = wallet
    ? "ยอดที่คุณสนับสนุน " + eth(stake)
    : "เชื่อม MetaMask เพื่อสนับสนุน ลงคะแนน หรือขอคืนเงิน";
}

function actionButton(label, style, action) {
  const button = node("button", label, "button " + style);
  button.type = "button";
  button.onclick = action;
  return button;
}

function evidenceText(item) {
  const line = node("p", "หลักฐานรอบที่ " + item.round + " · ", "muted");
  let url;
  try {
    url = new URL(item.evidence);
  } catch {}
  if (url && ["https:", "http:"].includes(url.protocol)) {
    const link = node("a", "เปิดหลักฐาน");
    link.href = url.href;
    link.title = url.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    line.append(link);
  } else line.append(item.evidence);
  return line;
}

function renderMilestones(current) {
  const { campaign, stages, stake, votedRound } = current;
  $("milestones").replaceChildren(
    ...stages.map((item, index) => {
      const row = document.createElement("li");
      const state = Number(item.stage);
      const heading = node("div", "", "spread");
      const tone =
        state === 1
          ? "vote"
          : state === 4
            ? "bad"
            : state === 2 || state === 3
              ? "good"
              : "";
      heading.append(
        node("h3", index + 1 + ". " + item.title),
        badge(STAGES[state], tone),
      );
      row.append(
        heading,
        node("p", item.description, "muted"),
        node("p", "งบ " + eth(item.amount)),
      );
      if (item.evidence) row.append(evidenceText(item));
      if (state !== 0)
        row.append(
          node(
            "p",
            "เห็นชอบ " + eth(item.yes) + " · ไม่เห็นชอบ " + eth(item.no),
            "muted",
          ),
        );
      if (
        BigInt(index) !== campaign.nextMilestone ||
        campaign.raised !== campaign.goal
      )
        return row;

      if (wallet === campaign.owner && (state === 0 || state === 4)) {
        const form = document.createElement("form");
        form.className = "inline";
        const label = node("label", "หลักฐานความสำเร็จ", "grow");
        const evidence = document.createElement("textarea");
        evidence.required = true;
        evidence.maxLength = 500;
        evidence.placeholder = "ลิงก์หลักฐานหรือคำอธิบาย";
        label.append(evidence);
        const submit = actionButton("ขอเบิก", "primary", null);
        submit.type = "submit";
        form.append(label, submit);
        form.onsubmit = (event) => {
          event.preventDefault();
          sendFor(current, (contract) =>
            contract.requestRelease(
              current.id,
              index,
              item.round,
              textValue(evidence.value, "หลักฐาน", 500),
            ),
          );
        };
        row.append(form);
      } else if (state === 1 && stake > 0n) {
        if (votedRound === item.round)
          row.append(node("p", "คุณลงคะแนนรอบนี้แล้ว", "muted"));
        else {
          const actions = node("div", "", "actions");
          for (const [approve, title, style] of [
            [true, "เห็นชอบ", "primary"],
            [false, "ไม่เห็นชอบ", "reject"],
          ]) {
            actions.append(
              actionButton(title, style, () =>
                sendFor(current, (contract) =>
                  contract.vote(current.id, index, item.round, approve),
                ),
              ),
            );
          }
          row.append(actions);
        }
      } else if (state === 2) {
        const actions = node("div", "", "actions");
        actions.append(
          actionButton("จ่ายตามที่อนุมัติ", "primary", () =>
            sendFor(current, (contract) => contract.release(current.id, index)),
          ),
        );
        row.append(actions);
      }
      return row;
    }),
  );
}

function appendLedger(entries) {
  const rows = Array.from(entries)
    .reverse()
    .map((item) => {
      const row = document.createElement("tr");
      const kind = Number(item.kind);
      const label =
        MOVEMENTS[kind] +
        (kind === 1 ? " #" + (Number(item.milestone) + 1) : "");
      const party = document.createElement("td");
      {
        const link = node("a", short(item.account));
        link.href = explorer + "/address/" + item.account;
        link.title = item.account;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        party.append(link);
      }
      row.append(
        node("td", label),
        party,
        node("td", (kind === 0 ? "+" : "−") + eth(item.amount)),
        node("td", date(item.recordedAt)),
      );
      return row;
    });
  $("ledger").append(...rows);
}

function render(current) {
  view = current;
  $("detail-panel").hidden = false;
  $("catalog").hidden = true;
  $("hero").hidden = true;
  const { campaign, id, entries, entryCount } = current;
  $("campaign-tag").textContent = "CAMPAIGN #" + id;
  $("campaign-title").textContent = campaign.title;
  $("campaign-owner").textContent = "เจ้าของโครงการ · " + campaign.owner;
  $("raised").textContent = eth(campaign.raised);
  $("goal").textContent = "เป้าหมาย " + eth(campaign.goal);
  $("deadline").textContent = "สิ้นสุด " + date(campaign.deadline);
  $("progress").value =
    Number((campaign.raised * 10000n) / campaign.goal) / 100;
  metrics([
    ["เงินในสัญญา", campaign.raised - campaign.paid - campaign.refunded],
    ["จ่ายแล้ว", campaign.paid],
    ["คืนแล้ว", campaign.refunded],
  ]);
  updateFunding();
  renderMilestones(current);
  renderContent(current);
  $("ledger").replaceChildren();
  if (entryCount === 0n) {
    const empty = node("td", "ยังไม่มีรายการ", "muted");
    empty.colSpan = 4;
    const row = document.createElement("tr");
    row.append(empty);
    $("ledger").append(row);
  } else appendLedger(entries);
  $("ledger-count").textContent = entryCount + " รายการ";
  $("more-ledger").hidden = current.offset === 0n;
  for (const id of ["campaign-panel", "milestone-panel", "ledger-panel"])
    $(id).hidden = false;
  notify("ledger-notice");
}

async function openCampaign(id, clear = true) {
  const revision = ++viewRevision;
  const account = wallet;
  if (clear) notify("action-notice");
  notify("lookup-notice", "กำลังอ่านข้อมูลจาก Sepolia…");
  try {
    const contract = contractAt(contractAddress);
    const [[campaign, milestoneCount, entryCount], stages, stake] =
      await Promise.all([
        contract.getCampaign(id),
        contract.getMilestones(id),
        account ? contract.contributions(id, account) : 0n,
      ]);
    const offset = entryCount > PAGE ? entryCount - PAGE : 0n;
    const [entries, votedRound, content] = await Promise.all([
      entryCount > 0n
        ? contract.getLedger(id, offset, entryCount - offset)
        : [],
      stake > 0n && campaign.nextMilestone < milestoneCount
        ? contract.votedInRound(id, campaign.nextMilestone, account)
        : 0n,
      readContent(id),
    ]);
    if (revision !== viewRevision) return;
    render({
      id,
      contract,
      campaign,
      stages,
      stake,
      votedRound,
      content,
      entryCount,
      entries,
      offset,
    });
    $("campaign-id").value = String(id);
    notify("lookup-notice");
    $("detail-panel").scrollIntoView({ block: "start" });
  } catch (error) {
    if (revision === viewRevision) {
      if (!$("detail-panel").hidden)
        notify("action-notice", explain(error), true);
      else notify("lookup-notice", explain(error), true);
    }
  }
}

async function listCampaigns(reset) {
  const revision = ++listRevision;
  const account = wallet;
  const mode = catalogMode;
  const button = $("more-campaigns");
  button.disabled = true;
  if (reset) {
    $("campaign-list").replaceChildren();
    button.hidden = true;
  }
  if (mode === "mine" && !account) {
    $("campaign-list").append(
      node(
        "p",
        "เชื่อม MetaMask เพื่อดูโครงการที่คุณเคยสนับสนุน",
        "empty-state",
      ),
    );
    notify("catalog-notice");
    button.disabled = false;
    return;
  }
  notify(
    "catalog-notice",
    mode === "mine"
      ? "กำลังค้นหารายการสนับสนุนของคุณ…"
      : "กำลังโหลดโครงการจาก Sepolia…",
  );
  try {
    const contract = contractAt(contractAddress);
    let cursor = reset ? await contract.campaignCount() : nextCampaign;
    do {
      const ids = [];
      for (let id = cursor; id > 0n && id > cursor - PAGE; id--) ids.push(id);
      const rows = await Promise.all(
        ids.map(async (id) => {
          const [[campaign, , count], extra] = await Promise.all([
            contract.getCampaign(id),
            readContent(id),
          ]);
          if (mode !== "mine")
            return {
              id,
              campaign,
              info: extra.info,
              total: 0n,
              refunded: false,
            };
          const stake = await contract.contributions(id, account);
          const support = await pastContribution(
            contract,
            id,
            account,
            campaign,
            count,
            stake,
          );
          return { id, campaign, info: extra.info, ...support };
        }),
      );
      if (
        revision !== listRevision ||
        wallet !== account ||
        mode !== catalogMode
      )
        return;
      for (const row of rows) {
        if (mode === "mine" && row.total === 0n) continue;
        $("campaign-list").append(
          campaignCard(row.id, row.campaign, row.total, row.refunded, row.info),
        );
      }
      cursor -= BigInt(ids.length);
    } while (mode === "mine" && cursor > 0n);
    nextCampaign = cursor;
    button.hidden = cursor === 0n || mode === "mine";
    if (!$("campaign-list").children.length) {
      $("campaign-list").append(
        node(
          "p",
          mode === "mine"
            ? "ยังไม่มีโครงการที่คุณร่วมสนับสนุน"
            : "ยังไม่มีโครงการ เริ่มโครงการแรกได้เลย",
          "empty-state",
        ),
      );
    }
    notify("catalog-notice");
  } catch (error) {
    if (revision === listRevision) {
      notify(
        "catalog-notice",
        explain(error) + "\nกดค้นหาอีกครั้งเพื่อลองใหม่",
        true,
      );
      if (mode === "discover")
        $("campaign-list").append(
          actionButton("โหลดโครงการอีกครั้ง", "secondary", () =>
            listCampaigns(true),
          ),
        );
    }
  } finally {
    if (revision === listRevision) button.disabled = false;
  }
}

async function send(notice, action, after) {
  if (busy) return;
  busy = true;
  const controls = [...document.querySelectorAll("button:not(:disabled)")];
  controls.forEach((button) => {
    button.disabled = true;
  });
  try {
    if (!signer) throw new Error("เชื่อม MetaMask ก่อน");
    const connectedSigner = signer;
    if (
      (await window.ethereum.request({ method: "eth_chainId" })) !== CHAIN_ID ||
      connectedSigner !== signer
    ) {
      throw new Error("เชื่อม MetaMask บน Sepolia ใหม่");
    }
    const contract = contractAt(contractAddress, connectedSigner);
    notify(notice, "ยืนยันธุรกรรมใน MetaMask");
    const tx = await action(contract);
    notify(notice, "กำลังรอยืนยันบน Sepolia…\n" + tx.hash);
    const receipt = await tx.wait();
    notify(notice, "บันทึกสำเร็จ\n" + receipt.hash);
    await after?.(receipt, contract);
  } catch (error) {
    notify(notice, explain(error), true);
  } finally {
    controls.forEach((button) => {
      button.disabled = false;
    });
    busy = false;
  }
}

function sendFor(current, action) {
  if (
    !current ||
    current.contract.target !== contractAddress ||
    current !== view
  )
    return;
  return send("action-notice", action, async () => {
    await openCampaign(current.id, false);
    await listCampaigns(true);
  });
}

function relabelPlan() {
  const rows = [...$("plan").children];
  rows.forEach((row, index) => {
    row.querySelector("legend").textContent = "ระยะที่ " + (index + 1);
    row.querySelector("button").hidden = rows.length === 1;
  });
  $("add-plan").hidden = rows.length >= 12;
}

function addPlan() {
  const row = $("plan-template").content.firstElementChild.cloneNode(true);
  row.querySelector("button").onclick = () => {
    row.remove();
    relabelPlan();
  };
  $("plan").append(row);
  relabelPlan();
}

function validateProject() {
  const form = $("create-form");
  const goal = amount(form.elements.goal.value);
  const deadline = Math.floor(
    new Date(form.elements.deadline.value).getTime() / 1000,
  );
  if (!Number.isSafeInteger(deadline) || deadline <= Date.now() / 1000)
    throw new Error("เลือกวันสิ้นสุดในอนาคต");
  return {
    title: textValue(form.elements.title.value, "ชื่อโครงการ", 160),
    goal,
    deadline,
    details: projectDetails(form, true),
  };
}

function campaignPlan(goal) {
  const plan = [...$("plan").children].map((row) => [
    textValue(row.querySelector("[name=stageTitle]").value, "ชื่อระยะงาน", 160),
    textValue(
      row.querySelector("[name=stageDetails]").value,
      "รายละเอียด",
      500,
    ),
    amount(row.querySelector("[name=stageAmount]").value),
  ]);
  if (plan.reduce((sum, stage) => sum + stage[2], 0n) !== goal)
    throw new Error("งบรวมทุกระยะต้องเท่ากับเป้าหมาย " + eth(goal));
  return plan;
}

function setCreateStep(step) {
  createStep = step;
  document.querySelectorAll("[data-create-step]").forEach((panel) => {
    panel.hidden = Number(panel.dataset.createStep) !== step;
  });
  document.querySelectorAll("[data-step-indicator]").forEach((indicator) => {
    const active = Number(indicator.dataset.stepIndicator) === step;
    indicator.classList.toggle("active", active);
    if (active) indicator.setAttribute("aria-current", "step");
    else indicator.removeAttribute("aria-current");
  });
  $("previous-step").hidden = step === 0;
  $("next-step").hidden = step === 2;
  $("save-campaign").hidden = step !== 2;
  notify("create-notice");
}

$("new-button").onclick = () => {
  $("create-panel").hidden = false;
  setCreateStep(0);
  $("create-panel").scrollIntoView({ block: "start" });
  $("create-form").elements.title.focus({ preventScroll: true });
};
$("close-create").onclick = () => {
  $("create-panel").hidden = true;
};
$("add-plan").onclick = addPlan;
$("previous-step").onclick = () => setCreateStep(Math.max(0, createStep - 1));
$("next-step").onclick = () => {
  try {
    const project = validateProject();
    if (createStep === 1) {
      const plan = campaignPlan(project.goal);
      $("review-summary").replaceChildren();
      for (const [label, value] of [
        ["ชื่อโครงการ", project.title],
        ["เป้าหมาย", eth(project.goal)],
        ["สิ้นสุดระดมทุน", date(project.deadline)],
        ...(project.details
          ? [
              ["หมวดหมู่", CATEGORIES[project.details.category]],
              ["ทีมงาน", project.details.team],
              ["เรื่องราว", project.details.story],
              ["รูปปก", project.details.coverUrl || "ยังไม่ได้เพิ่ม"],
            ]
          : []),
      ]) {
        const row = node("div", "");
        row.append(node("dt", label), node("dd", value));
        $("review-summary").append(row);
      }
      $("review-plan").replaceChildren(
        ...plan.map(([title, description, budget], index) => {
          const row = node("div", "", "review-stage");
          row.append(
            node("h3", index + 1 + ". " + title),
            node("p", description, "muted"),
            node("strong", eth(budget)),
          );
          return row;
        }),
      );
    }
    setCreateStep(createStep + 1);
  } catch (error) {
    notify("create-notice", explain(error), true);
  }
};
addPlan();
setCreateStep(0);

$("create-form").onsubmit = (event) => {
  event.preventDefault();
  if (createStep < 2) {
    $("next-step").click();
    return;
  }
  let submittedDetails;
  let submittedOwner;
  send(
    "create-notice",
    (contract) => {
      const project = validateProject();
      submittedDetails = project.details;
      submittedOwner = wallet;
      return contract.createCampaign(
        project.title,
        project.goal,
        project.deadline,
        campaignPlan(project.goal),
      );
    },
    async (receipt, contract) => {
      const created = receipt.logs
        .filter(
          (log) => log.address.toLowerCase() === contract.target.toLowerCase(),
        )
        .map((log) => contract.interface.parseLog(log))
        .find((log) => log?.name === "CampaignCreated");
      if (created) {
        if (submittedDetails) {
          try {
            sessionStorage.setItem(
              detailsDraftKey(created.args.id, submittedOwner),
              JSON.stringify(submittedDetails),
            );
          } catch {
            notify(
              "create-notice",
              "สร้างโครงการแล้ว แต่เก็บร่างรายละเอียดในเบราว์เซอร์ไม่ได้ กรุณาเพิ่มในหน้าโครงการ",
            );
          }
        }
        await listCampaigns(true);
        await openCampaign(created.args.id);
        $("create-panel").hidden = true;
        $("create-form").reset();
        $("plan").replaceChildren();
        addPlan();
        setCreateStep(0);
      }
    },
  );
};

function resetWallet(label) {
  walletRevision++;
  signer = wallet = undefined;
  $("wallet-info").textContent = label;
  listCampaigns(true);
  if (view) {
    view.stake = view.votedRound = 0n;
    ++viewRevision;
    notify("lookup-notice");
    updateFunding();
    renderMilestones(view);
    renderContent(view);
  }
}

$("wallet-button").onclick = async (event) => {
  if (busy) return;
  busy = true;
  const button = event.currentTarget;
  button.disabled = true;
  try {
    if (!window.ethereum) throw new Error("เปิดเว็บใน Chrome ที่มี MetaMask");
    notify("wallet-notice", "ตรวจคำขอใน MetaMask");
    await window.ethereum.request({ method: "eth_requestAccounts" });
    if (
      (await window.ethereum.request({ method: "eth_chainId" })) !== CHAIN_ID
    ) {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: CHAIN_ID }],
      });
    }
    const revision = walletRevision;
    const nextSigner = await new ethers.BrowserProvider(
      window.ethereum,
    ).getSigner();
    const account = await nextSigner.getAddress();
    if (revision !== walletRevision)
      throw new Error("บัญชีเปลี่ยน กรุณาเชื่อมใหม่");
    signer = nextSigner;
    wallet = account;
    $("wallet-info").textContent = short(wallet) + " · Sepolia";
    notify("wallet-notice");
    if (view) await openCampaign(view.id, false);
    await listCampaigns(true);
  } catch (error) {
    notify("wallet-notice", explain(error), true);
  } finally {
    button.disabled = false;
    busy = false;
  }
};
window.ethereum?.on("accountsChanged", () => resetWallet("บัญชีเปลี่ยน"));
window.ethereum?.on("chainChanged", () => resetWallet("เครือข่ายเปลี่ยน"));

$("lookup-form").onsubmit = (event) => {
  event.preventDefault();
  const raw = $("campaign-id").value.trim();
  if (!/^\d{1,78}$/.test(raw) || BigInt(raw) === 0n) {
    $("catalog").hidden = false;
    notify("lookup-notice", "กรอก ID โครงการเป็นเลขจำนวนเต็มบวก", true);
    return;
  }
  openCampaign(BigInt(raw));
};
$("contribute-form").onsubmit = (event) => {
  event.preventDefault();
  const current = view;
  const raw = event.currentTarget.elements.amount.value;
  sendFor(current, (contract) => {
    const value = amount(raw);
    if (value > current.campaign.goal - current.campaign.raised)
      throw new Error("ยอดเกินเงินที่ยังขาด");
    return contract.contribute(current.id, { value });
  });
};
$("refund-button").onclick = () => {
  const current = view;
  sendFor(current, (contract) => contract.refund(current.id));
};
$("more-ledger").onclick = async (event) => {
  const current = view;
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const offset = current.offset > PAGE ? current.offset - PAGE : 0n;
    const entries = await current.contract.getLedger(
      current.id,
      offset,
      current.offset - offset,
    );
    if (view !== current) return;
    current.offset = offset;
    appendLedger(entries);
    button.hidden = offset === 0n;
    notify("ledger-notice");
  } catch (error) {
    if (view === current) notify("ledger-notice", explain(error), true);
  } finally {
    button.disabled = false;
  }
};
$("more-campaigns").onclick = () => listCampaigns(false);
$("discover-nav").onclick = () => showCatalog("discover");
$("mine-nav").onclick = () => showCatalog("mine");
$("back-projects").onclick = () => showCatalog();
$("explore-button").onclick = () =>
  $("catalog").scrollIntoView({ block: "start", behavior: "smooth" });
listCampaigns(true);
setInterval(updateFunding, 1000);

$("project-cover").onerror = () => {
  $("project-cover").hidden = true;
};

$("details-form").onsubmit = (event) => {
  event.preventDefault();
  const current = view;
  let values;
  try {
    values = projectDetails(event.currentTarget);
  } catch (error) {
    notify("details-notice", explain(error), true);
    return;
  }
  sendContent(
    current,
    "details-notice",
    (contract) =>
      contract.setDetails(
        current.id,
        values.category,
        values.team,
        values.story,
        values.coverUrl,
      ),
    () => {
      try {
        sessionStorage.removeItem(
          detailsDraftKey(current.id, current.campaign.owner),
        );
      } catch {}
    },
  );
};

$("update-form").onsubmit = (event) => {
  event.preventDefault();
  const current = view;
  const form = event.currentTarget;
  let title, body, url;
  try {
    title = textValue(form.elements.updateTitle.value, "หัวข้อรายงาน", 160);
    body = textValue(form.elements.updateBody.value, "รายงาน", 2400);
    url = optionalHttps(form.elements.evidenceUrl.value);
  } catch (error) {
    notify("update-notice", explain(error), true);
    return;
  }
  sendContent(
    current,
    "update-notice",
    (contract) => contract.publishUpdate(current.id, title, body, url),
    () => form.reset(),
  );
};

$("more-updates").onclick = async (event) => {
  const current = view;
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const offset =
      current.content.offset > PAGE ? current.content.offset - PAGE : 0n;
    const entries = await current.content.contract.getUpdates(
      current.id,
      offset,
      current.content.offset - offset,
    );
    if (view !== current) return;
    current.content.offset = offset;
    appendUpdates(entries);
    button.hidden = offset === 0n;
  } catch (error) {
    if (view === current) notify("update-notice", explain(error), true);
  } finally {
    button.disabled = false;
  }
};
