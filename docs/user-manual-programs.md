# User Manual: Programs

This guide covers everything you need to know to create and manage Programs — recurring shows with Show Clocks and episode history — in PlayGen.

---

## Table of Contents

1. [What is a Program?](#1-what-is-a-program)
2. [Creating a Program](#2-creating-a-program)
   - [Day Presets](#21-day-presets)
   - [Time Slot](#22-time-slot)
   - [Music Template](#23-music-template)
3. [The Programs List](#3-the-programs-list)
   - [Empty State](#31-empty-state)
   - [Your Shows vs Unassigned](#32-your-shows-vs-unassigned)
4. [Program Detail View](#4-program-detail-view)
   - [Overview Tab](#41-overview-tab)
   - [Episodes Tab](#42-episodes-tab)
   - [Settings Tab](#43-settings-tab)
5. [Show Clock Editor](#5-show-clock-editor)
   - [Adding and Removing Slots](#51-adding-and-removing-slots)
   - [Target Minute Validation](#52-target-minute-validation)
   - [Multiple Clocks](#53-multiple-clocks)
6. [Deleting a Program](#6-deleting-a-program)

---

## 1. What is a Program?

A **Program** is a recurring radio show (e.g., *Morning Rush*, *Afternoon Drive*) that:

- Airs on specific days of the week during a defined time slot
- Has a **Show Clock** defining the order and type of content for each hour (songs, DJ talk, weather, jokes, etc.)
- Groups all **Episodes** (individual broadcast instances) for easy review and publishing

Programs sit above playlists in the PlayGen hierarchy: a playlist for a given day becomes an *episode* of the appropriate program when it falls within that program's schedule.

---

## 2. Creating a Program

**To create a new program:**

1. Click **Programs** in the left sidebar.
2. Click **New Program** (top-right).
3. Fill in the form:
   - **Color** — pick a color swatch to identify this show on the schedule at a glance.
   - **Program Name** — the show's on-air name (e.g., *Morning Rush*).
   - **Description** (optional) — a brief note about the show's format or audience.
   - **Airs On** — toggle the days the show broadcasts (see [Day Presets](#21-day-presets)).
   - **Start / End Time** — the hour the show begins and ends (12-hour format).
   - **Music Template** (optional) — the rotation template to use for scheduling songs in this program's episodes.
4. Click **Create & Set Up Clock** to save and immediately open the Show Clock editor.

### 2.1 Day Presets

Use the preset buttons below the day toggles to quickly select common schedules:

| Preset | Days selected |
|---|---|
| **Weekdays** | Mon – Fri |
| **Weekend** | Sat – Sun |
| **Daily** | Mon – Sun (all 7) |

You can then toggle individual days on or off to fine-tune the schedule.

### 2.2 Time Slot

Start and end times are set in whole hours. The selector uses 12-hour AM/PM format:

- **12:00 AM (midnight)** = hour 0 (start of day)
- **12:00 AM (next day)** = hour 24 (end of day, i.e., midnight roll-over)
- **12:00 PM (noon)** = hour 12

> **Note:** A program cannot start and end at the same hour. End time must be after start time.

### 2.3 Music Template

If your station has multiple rotation templates (e.g., a *Pop Heavy* template and a *Classic Hits* template), you can assign a specific one to this program. If left blank, the station's default template is used when generating playlists for this program's episodes.

---

## 3. The Programs List

### 3.1 Empty State

If no programs have been created yet, the list shows an empty-state prompt with a **Create your first program** button. Programs organise your daily shows and link music templates with DJ scripts via a Show Clock.

### 3.2 Your Shows vs Unassigned

The programs list is split into two sections:

- **Your Shows** — named programs you have created with custom schedules and Show Clocks.
- **Unassigned** — a special read-only *default* program that groups any playlists that do not belong to a named program. This is shown only when such playlists exist; it cannot be edited or deleted.

Each program card displays:
- A color indicator matching the program's chosen color
- Program name and optional description
- Active broadcast days (highlighted in the program color)
- Time slot (e.g., *6 AM – 10 AM*)
- Two action buttons: **View Episodes** and **Edit Clock**
- A settings (⚙) icon to open program settings

---

## 4. Program Detail View

Click a program card to open its detail view with three tabs.

### 4.1 Overview Tab

Shows a summary of the program:

- **Show Clock** panel — a color-coded bar showing the proportional duration of each content type, followed by a slot list. Clicking **Edit →** opens the Show Clock editor.
- **Program Info** panel — schedule, time slot, duration, and active/inactive status. A **View All Episodes →** button switches to the Episodes tab.

### 4.2 Episodes Tab

Browse all episodes of this program, grouped by month. Use the **← →** arrows to navigate between months.

Each episode row shows:
- Air date (weekday, date)
- Episode title (if set)
- Playlist status badge (draft, generating, ready, approved, etc.)
- A **Published** badge if the episode has been published to air
- A **View →** link to open the full episode detail

> **Tip:** Episodes are created automatically when a playlist is generated for a date that falls within this program's active days and time slot.

### 4.3 Settings Tab

Edit the program's name, description, and active status. Changes take effect immediately on save.

> The default *Unassigned* program does not have a settings tab — it cannot be modified.

---

## 5. Show Clock Editor

The Show Clock defines the sequence of content types for each hour of the program: songs, DJ segments, weather, jokes, time checks, station IDs, ad breaks, and listener activities.

**To open the Show Clock editor:**

1. From the Programs list, click **Edit Clock** on a program card.
   — or —
   From the Program detail view, click the **Edit Clock** button (top-right) or the **Edit →** link inside the Show Clock panel.

2. If no clock exists yet, click **Create Standard Hour Clock** to create the default clock.

### 5.1 Adding and Removing Slots

- Click **+ Add slot** at the bottom of the slot table to append a new row.
- Click the **✕** button at the end of any row to remove that slot.
- Use the **Content** dropdown to set the content type for each slot.
- For **Song** slots, optionally select a music category from the **Category / Type** dropdown.
- For **DJ Segment** slots, select a segment type (e.g., *song_intro*, *weather_tease*).

### 5.2 Target Minute Validation

The **Min** column sets the *target minute* within the hour when this slot should start (guidance only — not enforced in real-time). Valid values are **0–59**. Entering a value outside this range will be rejected.

The **Sec** column is the estimated duration of the slot in seconds (used for the preview bar proportions).

### 5.3 Multiple Clocks

A program can have more than one Show Clock (e.g., a *Drive Time* clock for peak hours and a *Standard* clock for off-peak). To add a clock:

1. Type a name in the **+ Add clock** input at the top.
2. Press **Enter** or click **Add**.
3. Optionally set the **Applies to hours** field (comma-separated 24h hours, e.g., `6, 7, 8`) to restrict when this clock is used.
4. Leave **Applies to hours** blank to use this clock for all hours.

The clock marked **default** is used when no other clock matches the current hour.

---

## 6. Deleting a Program

> **Warning:** Deleting a program is permanent. All episodes belonging to it will be moved to the *Unassigned* default program.

**To delete a program:**

1. Open the program detail view.
2. Click the **Settings** tab.
3. Scroll to the **Danger Zone** section.
4. Click **Delete Program**.
5. A confirmation dialog will appear. Click **Delete** to confirm, or **Cancel** to go back.

Only non-default programs can be deleted. The *Unassigned* program cannot be deleted.
