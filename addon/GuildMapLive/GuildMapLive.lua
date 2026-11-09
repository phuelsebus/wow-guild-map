-- Guild Map Live
-- 1) Jedes Gildenmitglied mit Addon sendet alle paar Sekunden Position/Level/XP per Addon-Nachricht an die Gilde.
-- 2) EIN Spieler aktiviert den Relay-Modus (/gmap relay on). Sein Addon sammelt alle Daten
--    (Addon-Nachrichten + Gildenliste) und zeichnet sie als Farbstreifen oben links auf den Bildschirm.
--    Der Companion (companion/index.js) liest diese Pixel aus und schickt sie an den Web-Server.

local PREFIX = "GMLive1"
local BROADCAST_INTERVAL = 5     -- Sekunden zwischen eigenen Updates
local MEMBER_TIMEOUT = 30        -- Sekunden ohne Nachricht => Addon-Daten gelten als offline
local FRAME_INTERVAL = 0.2       -- Sekunden pro Pixel-Frame (ein Mitglied pro Frame)
local ROSTER_INTERVAL = 30

-- Pixel-Protokoll, muss zu companion/protocol.js passen
local BLOCK = 4                  -- physische Pixel pro Block (Kantenlänge)
local DATA_BLOCKS = 140          -- Blöcke für Header + Nutzdaten (3 Nibbles pro Block)
local MAX_PAYLOAD = math.floor(DATA_BLOCKS * 3 / 2) - 6

local CONT_MAP = { [0] = { 1415, "E" }, [1] = { 1414, "K" } } -- Instanz-ID -> Kontinentkarte

local members = {}   -- name -> { class, level, xp, xpMax, rested, zone, online, hasAddon, cont, x, y, posTime, msgTime }
local relayFrame, textures
local seq = 0
local queue, queueIndex, offlineCursor = {}, 0, 0

local function shortName(n) return n and Ambiguate(n, "none") or nil end

local function member(name)
  local m = members[name]
  if not m then m = { name = name }; members[name] = m end
  return m
end

------------------------------------------------------------------------
-- Eigene Daten
------------------------------------------------------------------------
local function myPosition()
  local mapID = C_Map.GetBestMapForUnit("player")
  if not mapID then return end
  local pos = C_Map.GetPlayerMapPosition(mapID, "player")
  if not pos then return end -- z. B. in Instanzen
  local inst, world = C_Map.GetWorldPosFromMapPos(mapID, pos)
  local cm = inst and CONT_MAP[inst]
  if not cm or not world then return end
  local _, cpos = C_Map.GetMapPosFromWorldPos(inst, world, cm[1])
  if not cpos then return end
  local x, y = cpos:GetXY()
  if x < 0 or x > 1 or y < 0 or y > 1 then return end
  return cm[2], x, y
end

local function clean(s) return (tostring(s or ""):gsub("|", "/")) end

local function broadcast()
  if not IsInGuild() then return end
  local _, classFile = UnitClass("player")
  local cont, x, y = myPosition()
  local msg = table.concat({
    "1", classFile or "", UnitLevel("player"), UnitXP("player"), UnitXPMax("player"),
    GetXPExhaustion() or 0, cont or "-",
    x and math.floor(x * 10000 + 0.5) or 0, y and math.floor(y * 10000 + 0.5) or 0,
    clean(GetRealZoneText()):sub(1, 40),
  }, "|")
  C_ChatInfo.SendAddonMessage(PREFIX, msg, "GUILD")
  return msg
end

------------------------------------------------------------------------
-- Empfangen
------------------------------------------------------------------------
local function onAddonMessage(prefix, msg, channel, sender)
  -- nur Gildenkanal: sonst könnten Fremde per Flüstern Fake-Mitglieder einschleusen
  if prefix ~= PREFIX or channel ~= "GUILD" then return end
  local v, cls, lvl, xp, xpMax, rested, cont, x, y, zone = strsplit("|", msg)
  if v ~= "1" then return end
  local m = member(shortName(sender))
  local now = GetTime()
  m.class, m.level = cls, tonumber(lvl)
  m.xp, m.xpMax, m.rested = tonumber(xp), tonumber(xpMax), tonumber(rested)
  m.zone, m.hasAddon, m.online, m.msgTime = zone, true, true, now
  if cont == "K" or cont == "E" then
    m.cont, m.x, m.y, m.posTime = cont, tonumber(x), tonumber(y), now
  else
    m.cont = nil
  end
end

-- Senden und die eigenen Daten direkt übernehmen (ohne auf das Echo zu warten)
local function sendUpdate()
  local msg = broadcast()
  if msg then onAddonMessage(PREFIX, msg, "GUILD", UnitName("player")) end
end

local function readRoster()
  for i = 1, GetNumGuildMembers() do
    local name, _, _, level, _, zone, _, _, online, _, classFile = GetGuildRosterInfo(i)
    if name then
      local m = member(shortName(name))
      m.level = math.max(m.level or 0, level or 0)
      m.class = classFile or m.class
      local addonFresh = m.msgTime and (GetTime() - m.msgTime) < MEMBER_TIMEOUT
      if not addonFresh then m.zone = zone end
      m.online = online and true or false
      m.inRoster = true
    end
  end
end

local function requestRoster()
  if C_GuildInfo and C_GuildInfo.GuildRoster then C_GuildInfo.GuildRoster() elseif GuildRoster then GuildRoster() end
end

------------------------------------------------------------------------
-- Relay: Pixel-Streifen
------------------------------------------------------------------------
local function applyScale()
  if not relayFrame then return end
  local _, h = GetPhysicalScreenSize()
  -- effektive Skalierung 768/h => 1 UI-Einheit = 1 physisches Pixel
  relayFrame:SetScale((768 / h) / UIParent:GetEffectiveScale())
  relayFrame:ClearAllPoints()
  relayFrame:SetPoint("TOPLEFT", UIParent, "TOPLEFT", 0, 0)
end

local function setBlock(i, r, g, b) textures[i]:SetColorTexture(r / 255, g / 255, b / 255, 1) end

local function encode(payload)
  if #payload > MAX_PAYLOAD then payload = payload:sub(1, MAX_PAYLOAD) end
  seq = (seq + 1) % 256
  local sum, xr = 0, 0
  for i = 1, #payload do
    local b = payload:byte(i)
    sum = sum + b
    xr = bit.bxor(xr, b)
  end
  local bytes = { 0xA5, seq, #payload, sum % 256, math.floor(sum / 256) % 256, xr }
  for i = 1, #payload do bytes[#bytes + 1] = payload:byte(i) end
  local nib = {}
  for _, b in ipairs(bytes) do
    nib[#nib + 1] = math.floor(b / 16)
    nib[#nib + 1] = b % 16
  end
  for k = 1, DATA_BLOCKS do
    local a, b, c = nib[k * 3 - 2] or 0, nib[k * 3 - 1] or 0, nib[k * 3] or 0
    setBlock(k + 2, a * 16 + 8, b * 16 + 8, c * 16 + 8)
  end
end

local function record(m)
  local now = GetTime()
  local addonFresh = m.msgTime and (now - m.msgTime) < MEMBER_TIMEOUT
  local online = m.online
  local hasPos = addonFresh and m.cont
  return table.concat({
    clean(m.name), m.class or "", m.level or 0,
    m.xp or 0, m.xpMax or 0, m.rested or 0,
    clean(m.zone):sub(1, 40),
    online and 1 or 0, m.hasAddon and 1 or 0,
    hasPos and m.cont or "-", hasPos and m.x or 0, hasPos and m.y or 0,
    hasPos and math.floor(now - m.posTime) or 0,
  }, "|")
end

local function rebuildQueue()
  wipe(queue)
  local offline = {}
  for name, m in pairs(members) do
    if m.msgTime and GetTime() - m.msgTime > MEMBER_TIMEOUT and not m.inRoster then m.online = false end
    if m.online then queue[#queue + 1] = name else offline[#offline + 1] = name end
  end
  table.sort(offline)
  -- pro Durchlauf nur ein paar Offline-Mitglieder, damit Online-Spieler oft aktualisiert werden
  for i = 1, math.min(5, #offline) do
    offlineCursor = offlineCursor % #offline + 1
    queue[#queue + 1] = offline[offlineCursor]
  end
  queueIndex = 0
end

local elapsedFrame = 0
local function relayUpdate(_, dt)
  elapsedFrame = elapsedFrame + dt
  if elapsedFrame < FRAME_INTERVAL then return end
  elapsedFrame = 0
  queueIndex = queueIndex + 1
  if queueIndex > #queue then
    rebuildQueue()
    queueIndex = 1
    if #queue == 0 then return end
  end
  local m = members[queue[queueIndex]]
  if m then encode(record(m)) end
end

local function createRelay()
  if relayFrame then return end
  relayFrame = CreateFrame("Frame", "GuildMapLivePixels", UIParent)
  relayFrame:SetFrameStrata("TOOLTIP")
  relayFrame:SetFrameLevel(9999)
  relayFrame:SetSize((DATA_BLOCKS + 2) * BLOCK, BLOCK)
  textures = {}
  for i = 1, DATA_BLOCKS + 2 do
    local t = relayFrame:CreateTexture(nil, "OVERLAY")
    t:SetSize(BLOCK, BLOCK)
    t:SetPoint("TOPLEFT", relayFrame, "TOPLEFT", (i - 1) * BLOCK, 0)
    textures[i] = t
  end
  setBlock(1, 255, 0, 255) -- Marker magenta
  setBlock(2, 0, 255, 0)   -- Marker grün
  for i = 3, DATA_BLOCKS + 2 do setBlock(i, 8, 8, 8) end
  applyScale()
  relayFrame:SetScript("OnUpdate", relayUpdate)
end

local function setRelay(on)
  GuildMapLiveDB.relay = on
  if on then
    createRelay()
    relayFrame:Show()
    requestRoster()
  elseif relayFrame then
    relayFrame:Hide()
  end
end

------------------------------------------------------------------------
-- Events & Timer
------------------------------------------------------------------------
local ev = CreateFrame("Frame")
ev:RegisterEvent("ADDON_LOADED")
ev:RegisterEvent("PLAYER_ENTERING_WORLD")
ev:RegisterEvent("CHAT_MSG_ADDON")
ev:RegisterEvent("GUILD_ROSTER_UPDATE")
ev:RegisterEvent("PLAYER_XP_UPDATE")
ev:RegisterEvent("PLAYER_LEVEL_UP")
ev:RegisterEvent("ZONE_CHANGED_NEW_AREA")
ev:RegisterEvent("UI_SCALE_CHANGED")
ev:RegisterEvent("DISPLAY_SIZE_CHANGED")

local lastBroadcast = 0
local function broadcastSoon()
  if GetTime() - lastBroadcast > 2 then
    lastBroadcast = GetTime()
    sendUpdate()
  end
end

ev:SetScript("OnEvent", function(_, event, ...)
  if event == "ADDON_LOADED" and ... == "GuildMapLive" then
    GuildMapLiveDB = GuildMapLiveDB or {}
    C_ChatInfo.RegisterAddonMessagePrefix(PREFIX)
  elseif event == "PLAYER_ENTERING_WORLD" then
    if GuildMapLiveDB.relay then setRelay(true) end
    requestRoster()
    C_Timer.After(3, sendUpdate)
  elseif event == "CHAT_MSG_ADDON" then
    onAddonMessage(...)
  elseif event == "GUILD_ROSTER_UPDATE" then
    readRoster()
  elseif event == "UI_SCALE_CHANGED" or event == "DISPLAY_SIZE_CHANGED" then
    applyScale()
  else
    broadcastSoon()
  end
end)

C_Timer.NewTicker(BROADCAST_INTERVAL, function()
  lastBroadcast = GetTime()
  sendUpdate()
end)
C_Timer.NewTicker(ROSTER_INTERVAL, function() if GuildMapLiveDB and GuildMapLiveDB.relay then requestRoster() end end)

SLASH_GUILDMAPLIVE1 = "/gmap"
SlashCmdList.GUILDMAPLIVE = function(arg)
  arg = (arg or ""):lower()
  if arg == "relay on" then
    setRelay(true)
    print("|cffe3c27aGuild Map Live:|r Relay aktiv. Companion auf diesem PC starten.")
  elseif arg == "relay off" then
    setRelay(false)
    print("|cffe3c27aGuild Map Live:|r Relay aus.")
  else
    local n, withAddon = 0, 0
    for _, m in pairs(members) do
      n = n + 1
      if m.hasAddon then withAddon = withAddon + 1 end
    end
    local cont, x, y = myPosition()
    print(("|cffe3c27aGuild Map Live:|r Relay %s, %d Mitglieder bekannt (%d mit Addon). Eigene Position: %s"):format(
      GuildMapLiveDB.relay and "AN" or "aus", n, withAddon,
      cont and ("%s %.1f / %.1f"):format(cont, x * 100, y * 100) or "unbekannt"))
    print("  /gmap relay on|off")
  end
end
