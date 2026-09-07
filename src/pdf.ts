// PDF-Bericht mit jsPDF + autoTable: Terminal-nüchtern (Courier), A4,
// Kopf mit Firmenname, Zeitraum und Gruppierung, Summentabelle, optional
// Detailliste der Einträge. Farben sparsam — Papier ist kein Bildschirm.

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Data, Entry, GroupBy, Lang, Settings, Summary } from './api';
import { Dict } from './i18n';
import { dateKey, durationSecs, fmtDate, fmtHM, fmtHours, fmtMoney, fmtTime, roundSecs } from './util';

const PAGE_W = 210;
const M = 18;
const INK: [number, number, number] = [30, 41, 59];
const DIM: [number, number, number] = [100, 116, 139];
const HEAD: [number, number, number] = [226, 232, 240];

export function buildReportPdf({
  summary,
  groupBy,
  rangeLabel,
  entries,
  data,
  settings,
  t,
  lang,
  now,
}: {
  summary: Summary;
  groupBy: GroupBy;
  rangeLabel: string;
  entries: Entry[];
  data: Data;
  settings: Settings;
  t: Dict;
  lang: Lang;
  now: Date;
}): { bytes: Uint8Array; suggestedName: string } {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const F = 'courier';
  const groupLabel = { project: t.byProject, client: t.byClient, person: t.byPerson, task: t.byTask }[groupBy];
  const showAmount = summary.totalAmount > 0;
  const rounded = settings.rounding > 0;

  // Kopf
  let y = M;
  pdf.setFont(F, 'bold');
  pdf.setFontSize(11);
  pdf.setTextColor(...INK);
  if (settings.companyName.trim()) {
    pdf.text(settings.companyName.trim(), M, y);
    y += 6;
  }
  pdf.setFontSize(15);
  pdf.text(`${t.reportTitle} — ${groupLabel}`, M, y);
  y += 6;
  pdf.setFont(F, 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(...DIM);
  pdf.text(`// ${t.range}: ${rangeLabel}`, M, y);
  y += 4.5;
  if (rounded) {
    pdf.text(`// ${t.rounding}: ${t.roundingMin(settings.rounding)}`, M, y);
    y += 4.5;
  }
  pdf.text(`// ${t.generatedAt} ${fmtDate(now, lang)} ${fmtTime(now.toISOString())} · timelog.`, M, y);
  y += 3;
  pdf.setDrawColor(...HEAD);
  pdf.line(M, y, PAGE_W - M, y);
  y += 5;

  // Summentabelle
  const head = [[groupLabel, t.colEntries, t.colDuration, t.hours, ...(rounded ? [t.colRounded] : []), t.colBillableHours, ...(showAmount ? [t.colAmount] : [])]];
  const body = summary.rows.map((r) => [
    r.label || t.unassigned,
    String(r.entries),
    fmtHM(r.seconds),
    fmtHours(r.roundedSeconds, lang),
    ...(rounded ? [fmtHM(r.roundedSeconds)] : []),
    fmtHM(r.billableSeconds),
    ...(showAmount ? [fmtMoney(r.amount, lang)] : []),
  ]);
  body.push([
    t.total,
    String(summary.entries),
    fmtHM(summary.totalSeconds),
    fmtHours(summary.totalRoundedSeconds, lang),
    ...(rounded ? [fmtHM(summary.totalRoundedSeconds)] : []),
    fmtHM(summary.totalBillableSeconds),
    ...(showAmount ? [fmtMoney(summary.totalAmount, lang)] : []),
  ]);
  const numCols: Record<number, { halign: 'right' }> = {};
  for (let i = 1; i < head[0].length; i++) numCols[i] = { halign: 'right' };
  autoTable(pdf, {
    startY: y,
    margin: { left: M, right: M },
    head,
    body,
    theme: 'plain',
    styles: { font: F, fontSize: 8.5, cellPadding: 1.8, textColor: INK, lineColor: HEAD, lineWidth: 0.1 },
    headStyles: { fillColor: HEAD, textColor: INK, fontStyle: 'bold' },
    columnStyles: numCols,
    didParseCell: (d) => {
      if (d.section === 'body' && d.row.index === body.length - 1) d.cell.styles.fontStyle = 'bold';
    },
  });
  y = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

  // Detailliste
  if (entries.length > 0) {
    const expert = settings.mode === 'expert';
    const dhead = [[t.colDate, t.colFrom, t.colTo, ...(expert ? [t.colPerson] : []), t.colProject, ...(expert ? [t.colTask] : []), t.colNote, t.colDuration]];
    const dbody = entries.map((e) => [
      fmtDate(new Date(e.start), lang),
      fmtTime(e.start),
      e.end ? fmtTime(e.end) : t.timerRunning,
      ...(expert ? [data.persons.find((p) => p.id === e.personId)?.name ?? ''] : []),
      data.projects.find((p) => p.id === e.projectId)?.name ?? '',
      ...(expert ? [(e.taskId && data.tasks.find((x) => x.id === e.taskId)?.name) || ''] : []),
      e.note,
      fmtHM(roundSecs(durationSecs(e, now), settings.rounding)),
    ]);
    pdf.setFont(F, 'bold');
    pdf.setFontSize(10);
    pdf.setTextColor(...INK);
    if (y > 260) {
      pdf.addPage();
      y = M;
    }
    pdf.text(t.entries, M, y);
    y += 3;
    const last = dhead[0].length - 1;
    autoTable(pdf, {
      startY: y,
      margin: { left: M, right: M },
      head: dhead,
      body: dbody,
      theme: 'plain',
      styles: { font: F, fontSize: 7.5, cellPadding: 1.4, textColor: INK, lineColor: HEAD, lineWidth: 0.1, overflow: 'linebreak' },
      headStyles: { fillColor: HEAD, textColor: INK, fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 20 }, 1: { cellWidth: 12 }, 2: { cellWidth: 12 }, [last]: { cellWidth: 16, halign: 'right' } },
    });
  }

  // Fußzeile mit Seitenzahl
  const pages = pdf.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i);
    pdf.setFont(F, 'normal');
    pdf.setFontSize(7.5);
    pdf.setTextColor(...DIM);
    pdf.text(`${i} / ${pages}`, PAGE_W - M, 290, { align: 'right' });
    pdf.text('timelog.', M, 290);
  }

  const suggestedName = `timelog_${t.reportTitle.toLowerCase().replace(/\s+/g, '-')}_${dateKey(now)}.pdf`;
  return { bytes: new Uint8Array(pdf.output('arraybuffer')), suggestedName };
}
