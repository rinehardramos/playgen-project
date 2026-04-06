# User Manual: Playlists

This guide covers everything you need to know to view, manage, approve, and export playlists in PlayGen.

---

## Table of Contents

1. [What is a Playlist?](#1-what-is-a-playlist)
2. [Viewing Playlists and Filtering by Month](#2-viewing-playlists-and-filtering-by-month)
3. [Understanding Playlist Statuses](#3-understanding-playlist-statuses)
4. [Approving a Playlist](#4-approving-a-playlist)
5. [Overriding a Song Entry (Manual Override)](#5-overriding-a-song-entry-manual-override)
6. [Regenerating a Single Slot](#6-regenerating-a-single-slot)
7. [Exporting a Playlist (XLSX / CSV)](#7-exporting-a-playlist-xlsx--csv)
8. [The DJ Script Tab](#8-the-dj-script-tab)
   - [Generating a DJ Script](#81-generating-a-dj-script)
   - [Reviewing Script Segments](#82-reviewing-script-segments)
   - [Approving and Rejecting Segments](#83-approving-and-rejecting-segments)
   - [Per-Segment TTS Controls](#84-per-segment-tts-controls)
   - [Bulk TTS Generation](#85-bulk-tts-generation)
   - [Program Preview](#86-program-preview)

---

## 1. What is a Playlist?

A **playlist** is an ordered list of songs scheduled for broadcast during a specific time block at your radio station. PlayGen generates playlists automatically based on the rotation rules and song categories configured in your **Schedule Templates**.

Each playlist belongs to a single station and covers a defined time period (typically one day or one week). Once generated, you can review, adjust, approve, and export the playlist before it goes to air.

---

## 2. Viewing Playlists and Filtering by Month

**To view your playlists:**

1. Click **Playlists** in the left sidebar.
2. The list shows all playlists for your station, sorted by date (most recent first).

**To filter by month:**

1. Locate the **Month** filter at the top of the playlist list.
2. Click the dropdown and select the month and year you want to view.
3. The list will update immediately to show only playlists within that month.

> **Tip:** Use the month filter to quickly navigate to a specific broadcast week when approving or exporting in bulk.

---

## 3. Understanding Playlist Statuses

Each playlist displays a colored status badge. Here is what each status means:

| Status | What it means |
|---|---|
| **Draft** | The playlist has been created but generation has not started yet. |
| **Generating** | PlayGen is currently building the song list. This may take a few seconds to a few minutes depending on playlist length. |
| **Ready** | Generation is complete. The playlist is waiting for your review and approval. |
| **Approved** | A team member has reviewed the playlist and confirmed it is ready for broadcast. |
| **Exported** | The playlist has been downloaded as an XLSX or CSV file for use in your playout system. |
| **Failed** | Something went wrong during generation. See the error details on the playlist page and contact your administrator if the problem persists. |

> **Important:** Only **Ready** playlists can be approved. Only **Approved** playlists can be exported.

---

## 4. Approving a Playlist

Approval confirms that the playlist has been reviewed and is cleared for broadcast.

**Steps:**

1. From the playlist list, click a playlist with **Ready** status to open it.
2. Review the song order and any flagged items.
3. If you are satisfied, click the **Approve** button in the top-right corner.
4. The playlist status will change to **Approved**.

> **Note:** Approving a playlist does not make changes to it — it simply marks it as reviewed. You can still make manual overrides after approval (the status will revert to Ready).

---

## 5. Overriding a Song Entry (Manual Override)

You can replace any song in a playlist with a different song from your library.

**Steps:**

1. Open the playlist you want to edit.
2. Find the song slot you want to change.
3. Click the **Override** icon (pencil icon) next to that slot.
4. A search panel will open. Type the song title or artist name to search your library.
5. Select the replacement song from the search results.
6. Click **Confirm Override**.

The slot will update immediately with the new song. The original song is recorded in the override history so you can see what was changed.

> **Note:** Overriding a song resets the playlist status from **Approved** back to **Ready**, requiring re-approval before export.

---

## 6. Regenerating a Single Slot

If a song slot looks out of place (wrong category, repeated artist, etc.), you can ask PlayGen to regenerate just that one slot without rebuilding the entire playlist.

**Steps:**

1. Open the playlist.
2. Find the slot you want to regenerate.
3. Click the **Regenerate** icon (refresh icon) next to that slot.
4. Confirm the action in the dialog that appears.
5. PlayGen will replace that slot with a new song that fits the rotation rules for that time block.

> **Tip:** Use single-slot regeneration sparingly. If multiple slots look wrong, it may be a sign that your rotation rules or category balances need adjustment — contact your schedule administrator.

---

## 7. Exporting a Playlist (XLSX / CSV)

Once a playlist is **Approved**, you can export it to load into your playout software.

**Steps:**

1. Open an **Approved** playlist.
2. Click the **Export** button in the top-right corner.
3. Choose your format:
   - **XLSX** — Microsoft Excel format, best for editing and sharing internally.
   - **CSV** — Comma-separated values, compatible with most playout systems.
4. The file will download to your computer automatically.

> **Tip:** XLSX exports include formatting (headers, column widths). CSV exports are plain text and best for automated import pipelines.

---

## 8. The DJ Script Tab

The **DJ Script** tab on any playlist lets you generate, review, and produce AI-written announcer scripts for each song segment. These scripts can be converted to audio using text-to-speech (TTS).

### 8.1 Generating a DJ Script

1. Open a playlist and click the **DJ Script** tab.
2. If no script exists yet, click **Generate Script**.
3. PlayGen will send the playlist details to the AI and create a script segment for each song slot (and any configured segment types such as weather, time check, or station ID).
4. Generation typically takes 15–60 seconds depending on playlist length.

### 8.2 Reviewing Script Segments

Once generated, the script is displayed as a list of **segments** — one per song slot or special segment type. Each segment shows:

- The segment type (e.g., Song Intro, Station ID, Weather Tease)
- The AI-written script text
- The current review status (Pending, Approved, Rejected)

Scroll through the segments to read the full script. Click any segment to expand it for easier reading.

### 8.3 Approving and Rejecting Segments

You can approve or reject each segment individually.

**To approve a segment:**
1. Click the **Approve** button (checkmark) on the segment card.
2. The segment status changes to **Approved** (green badge).

**To reject a segment:**
1. Click the **Reject** button (X) on the segment card.
2. Optionally, type feedback in the comment box that appears.
3. The segment status changes to **Rejected** (red badge).

Rejected segments can be regenerated individually by clicking **Regenerate** on that segment card. You can also type a rewrite instruction in the chat box below the segment to guide the AI toward a specific tone or content.

> **Tip:** Use the chatbox to give the AI direct instructions, for example: *"Make this sound more energetic"* or *"Mention that it's Friday."*

### 8.4 Per-Segment TTS Controls

Each approved segment can be converted to audio individually.

**Steps:**

1. Find an **Approved** segment.
2. Click **Generate Audio** (speaker icon) on that segment card.
3. PlayGen will use the configured TTS provider to produce an audio file.
4. Once ready, a playback control will appear. Click **Play** to preview the audio directly in the browser.

> **Note:** TTS generation consumes API credits. Check with your administrator if you are unsure whether your station has TTS enabled.

### 8.5 Bulk TTS Generation

Instead of generating audio one segment at a time, you can generate TTS for all approved segments at once.

**Steps:**

1. On the DJ Script tab, click **Generate All Audio** at the top of the segment list.
2. PlayGen will queue TTS generation for every **Approved** segment that does not already have audio.
3. A progress indicator shows how many segments remain.
4. When complete, all segments will have playback controls.

> **Warning:** Bulk TTS can be slow for long playlists (30+ segments). Avoid navigating away from the page while generation is in progress.

### 8.6 Program Preview

The **Program Preview** shows a full read-through view of your playlist — songs and DJ segments interleaved in broadcast order — so you can get a feel for the complete show flow before it goes to air.

**To open Program Preview:**

1. On the DJ Script tab, click **Program Preview** (or navigate to the preview page from the playlist header).
2. The preview opens in full-screen and shows each item in order:
   - Song entries (title, artist, duration)
   - DJ script segments (text and audio player if TTS has been generated)
3. Use the **Play** buttons on each segment to listen to the TTS audio.
4. Click **Exit Preview** (or press `Escape`) to return to the playlist view.

> **Tip:** Share the preview link with your on-air talent so they can read along or listen to the scripted segments before the show.
