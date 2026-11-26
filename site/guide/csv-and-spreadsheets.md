---
title: CSV files and spreadsheets
order: 12
---

# CSV files and spreadsheets

CSV files open in a grid you can edit, so you never count commas again. Workbooks from Excel, LibreOffice
and Numbers open in a read-only preview, every sheet of them. CSV settings are in the
[CSV reference](../../docs/preferences.md#csv).

## Edit a CSV file as a grid

**File Explorer › click a `.csv` file**

The **CSV Preview Editor** shows a CSV file as a table of cells. It is the same document as the text
editor: the same unsaved marker, Save, Undo and Auto Save. A save rewrites only the fields you changed, so
your diffs stay small.

1. Click the CSV file in the File Explorer. It opens in the **CSV Preview Editor**.
2. Edit cells as you would in any spreadsheet.
3. Save with **Ctrl+S**.

![A CSV file in the grid editor](images/csv-and-spreadsheets/preview-a-csv.png)

## Move around and edit cells

**The CSV grid**

You can work through a table from the keyboard alone. The arrow keys move the selection, and a cell you
start editing keeps the arrows for its own caret until you finish.

1. Move with the arrow keys.
2. Press **Enter** or **F2**, or double-click, to edit a cell.
3. Press **Delete** to clear it.

## Insert rows and columns

**The CSV grid › right-click a row number or column letter**

The row and column menus add empty rows and columns where you need them, or insert ones you copied from
another grid.

1. Right-click a row number or a column letter.
2. Choose to insert above, below, left or right, or to insert rows or columns you copied.

To add a row at the end, type into the empty row below the last one. It joins the file only once you type or paste
into it, and a new empty row appears under it.

## Copy and paste cells

**The CSV grid › Ctrl+C / Ctrl+V**

Cells copy as tab-separated text, the format other spreadsheets read, so data moves both ways between throng
and Excel or LibreOffice.

1. Select the cells and copy them.
2. Paste where you want them.
3. To empty a selection, choose **Clear Cells**.

## Set column widths and edit long cells

**The CSV grid › column letters and row numbers**

A column can fit its widest value, or take a width you set. A cell too long to read in the grid opens in a
dialog of its own, with a JSON value laid out on several lines.

1. Double-click a column letter to fit it to its content.
2. Or right-click it and set **Column Width**.
3. A long cell opens in a cell dialog for editing.

## Keep headers in view and wrap text

**The CSV grid's menu**

In a big table you can hold the first row and column in place while the rest scrolls, and wrap long text so
each cell shows in full.

1. Lock the first row and the first column, so they stay put as you scroll.
2. Turn on **Wrap** to see long text in full.

## Fix a CSV that will not parse

**The notice a broken CSV opens**

A stray quote can unbalance every field after it. When that happens, throng opens a notice naming the line
where the quotes stop balancing.

1. Read the notice for the line number.
2. Click **Open in Editor** and fix that line.

## Read a spreadsheet

**File Explorer › click a workbook**

The spreadsheet preview opens Excel, LibreOffice and Numbers workbooks without another program. It shows
every sheet, with a switcher along the bottom.

1. Click the `.xlsx`, `.xls`, `.ods` or `.numbers` file (or one of their relatives).
2. Switch sheets with the switcher along the bottom.

> [!NOTE]
> Workbooks are read-only. Formula cells show their stored values; throng recalculates nothing.
