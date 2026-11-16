import PropTypes from 'prop-types';
import { useMemo, useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TableSortLabel from '@mui/material/TableSortLabel';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

// project imports
import { FLAG_LABELS } from 'api/results';
import QcChip from 'sections/trials/QcChip';
import { NESTED_PANEL_FRAMED } from 'sections/trials/surfaces';

const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.8125rem' };
const cell = { ...mono, whiteSpace: 'nowrap' };

// Most serious first, as the processing job orders a plot's flags.
const FLAG_ORDER = ['near-zero', 'low-confidence', 'cut-by-reach', 'lost-to-neighbour', 'saturated'];
const QC_ORDER = { pending: 0, rejected: 1, accepted: 2, passed: 3 };

/** The number behind a flag, so a reviewer sees how far past its threshold a plot is. */
export function flagEvidence(plot, flag) {
  switch (flag) {
    case 'near-zero':
    case 'saturated':
      return `${plot.cover.toFixed(1)}% of the box is canopy`;
    case 'low-confidence':
      return `model certainty ${plot.confidence.toFixed(2)} over the box`;
    case 'cut-by-reach':
      return `${plot.cutByReachM2.toFixed(3)} m² stopped at the reach limit`;
    case 'lost-to-neighbour':
      return `${plot.lostToNeighbourM2.toFixed(3)} m² in the box went to ${plot.neighbours?.length ? plot.neighbours.join(', ') : 'a neighbour'}`;
    default:
      return '';
  }
}

// Field order: by row, then column; plots without them after, by id.
const plotOrder = (plot) => `${String(plot.row ?? 99999).padStart(5, '0')} ${String(plot.col ?? 99999).padStart(5, '0')} ${plot.plotId}`;

const numeric = (value) => {
  const n = Number(value);
  return value == null || value === '' || Number.isNaN(n) ? null : n;
};

/** The columns, each with how it sorts. Rep and the change since the previous date only when there is something to show. */
function columns({ previousDate, hasRep, typicalChange }) {
  return [
    { key: 'plot', label: 'Plot', get: (row) => plotOrder(row.plot) },
    { key: 'genotype', label: 'Genotype', get: (row) => numeric(row.plot.genotype) ?? row.plot.genotype ?? null },
    ...(hasRep ? [{ key: 'rep', label: 'Rep', get: (row) => numeric(row.plot.rep) ?? row.plot.rep ?? null }] : []),
    { key: 'cover', label: 'Cover in box', get: (row) => row.plot.cover, help: 'Canopy inside the plot’s box, as a share of the box.' },
    ...(previousDate
      ? [
          {
            key: 'change',
            label: `Since ${previousDate.slice(5)}`,
            get: (row) => row.change,
            help: `Cover in box now minus on ${previousDate}, in percentage points.${
              typicalChange != null ? ` The field’s median change was ${typicalChange > 0 ? '+' : ''}${typicalChange.toFixed(1)}.` : ''
            } Sort to find the plots that moved most against it.`
          }
        ]
      : []),
    {
      key: 'canopy',
      label: 'Canopy',
      get: (row) => row.plot.areaM2,
      help: 'The plot’s canopy area from the watershed, including what grew past its box.'
    },
    {
      key: 'confidence',
      label: 'Confidence',
      get: (row) => row.plot.confidence,
      help: 'How sure the model was over the box, 0 to 1. Below 0.6 is flagged.'
    },
    { key: 'flag', label: 'Why flagged', get: (row) => (row.plot.flag ? FLAG_ORDER.indexOf(row.plot.flag) : null) },
    { key: 'status', label: 'Status', get: (row) => QC_ORDER[row.plot.qc] ?? 9 }
  ];
}

// ==============================|| REVIEW - PLOT TABLE ||============================== //

/**
 * The Review tab's working list: one row per plot, sortable on every column,
 * with why a plot was flagged and the number behind it, and how its cover
 * moved since the previous date. A row (or its plot id, from the keyboard)
 * opens the plot in the Reviewer.
 *
 * `previous` maps plotId → that plot on `previousDate`; `typicalChange` is the
 * field's median change between the two. Changes aren't coloured: in a yam
 * season most plots rise or fall together and spread widely, so a cut-off
 * would mark a third of the field; sorting the column finds the extremes.
 */
export default function PlotReviewTable({
  plots,
  previous = null,
  previousDate = null,
  typicalChange = null,
  hasRep = false,
  onOpen,
  emptyText = 'No plots match.'
}) {
  const [orderBy, setOrderBy] = useState('plot');
  const [direction, setDirection] = useState('asc');
  const cols = useMemo(
    () => columns({ previousDate: previous ? previousDate : null, hasRep, typicalChange }),
    [previous, previousDate, hasRep, typicalChange]
  );
  const showChange = cols.some((column) => column.key === 'change');

  const rows = useMemo(() => {
    const withChange = plots.map((plot) => {
      const before = previous?.get(plot.plotId);
      return { plot, before, change: before ? plot.cover - before.cover : null };
    });
    const column = cols.find((candidate) => candidate.key === orderBy) || cols[0];
    return withChange.sort((a, b) => {
      const va = column.get(a);
      const vb = column.get(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1; // blanks last, whichever way
      if (vb == null) return -1;
      const order =
        typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true });
      return direction === 'asc' ? order : -order;
    });
  }, [plots, previous, cols, orderBy, direction]);

  const sortBy = (key) => {
    if (orderBy === key) setDirection(direction === 'asc' ? 'desc' : 'asc');
    else {
      setOrderBy(key);
      // Biggest first for cover and areas; lowest first otherwise, which puts the
      // worries on top: low confidence, drops, the worst flag, plots needing review.
      setDirection(['canopy', 'cover'].includes(key) ? 'desc' : 'asc');
    }
  };

  return (
    <TableContainer
      sx={(theme) => ({
        ...NESTED_PANEL_FRAMED(theme),
        maxHeight: 620,
        '& tbody tr:last-of-type td': { borderBottom: 0 }
      })}
    >
      <Table size="small" stickyHeader aria-label="Plots to review" sx={{ '& th, & td': { px: 1 }, '& th': { whiteSpace: 'nowrap' } }}>
        <TableHead>
          <TableRow>
            {cols.map((column) => (
              <TableCell key={column.key} align="center" sortDirection={orderBy === column.key ? direction : false}>
                {/* describeChild: the tip describes the header; its name stays the column's */}
                <Tooltip title={column.help || ''} placement="top" disableHoverListener={!column.help} describeChild>
                  <TableSortLabel
                    active={orderBy === column.key}
                    direction={orderBy === column.key ? direction : 'asc'}
                    onClick={() => sortBy(column.key)}
                  >
                    {column.label}
                  </TableSortLabel>
                </Tooltip>
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={cols.length}>
                <Typography variant="body2" color="text.secondary" align="center" sx={{ py: 3 }}>
                  {emptyText}
                </Typography>
              </TableCell>
            </TableRow>
          )}
          {rows.map(({ plot, before, change }) => {
            const others = (plot.flags || []).filter((flag) => flag !== plot.flag);
            return (
              <TableRow key={plot.plotId} hover onClick={() => onOpen?.(plot.plotId)} sx={{ cursor: onOpen ? 'pointer' : 'default' }}>
                <TableCell align="center" sx={cell}>
                  <ButtonBase
                    aria-label={`Open plot ${plot.plotId} in the Reviewer`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpen?.(plot.plotId);
                    }}
                    sx={{
                      ...mono,
                      fontWeight: 600,
                      px: 0.75,
                      py: 0.25,
                      borderRadius: 0.5,
                      color: plot.qc === 'pending' ? 'primary.main' : 'text.primary',
                      '&:hover, &.Mui-focusVisible': { textDecoration: 'underline' }
                    }}
                  >
                    {plot.plotId}
                  </ButtonBase>
                  {plot.row != null && plot.plotId !== `${plot.row}-${plot.col}` && (
                    <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
                      r{plot.row} c{plot.col}
                    </Typography>
                  )}
                </TableCell>
                <TableCell align="center" sx={mono}>
                  {plot.genotype ?? '—'}
                </TableCell>
                {hasRep && (
                  <TableCell align="center" sx={mono}>
                    {plot.rep ?? '—'}
                  </TableCell>
                )}
                <TableCell align="center" sx={cell}>
                  {plot.cover.toFixed(1)}%
                </TableCell>
                {showChange && (
                  <TableCell
                    align="center"
                    sx={cell}
                    title={
                      before
                        ? `${before.cover.toFixed(1)}% on ${previousDate}${typicalChange != null ? ` · field median change ${typicalChange.toFixed(1)}` : ''}`
                        : `Not in the ${previousDate} result`
                    }
                  >
                    {change == null ? (
                      <Box component="span" sx={{ color: 'text.disabled' }}>
                        —
                      </Box>
                    ) : (
                      <Box component="span">
                        {change > 0 ? '+' : ''}
                        {change.toFixed(1)}
                      </Box>
                    )}
                  </TableCell>
                )}
                <TableCell align="center" sx={cell} title={`${Math.round(plot.areaCm2).toLocaleString('en-US')} cm²`}>
                  {plot.areaM2.toFixed(3)} m²
                </TableCell>
                <TableCell align="center" sx={mono}>
                  <Box component="span" sx={{ color: plot.confidence < 0.6 ? 'warning.main' : 'text.primary' }}>
                    {plot.confidence.toFixed(2)}
                  </Box>
                </TableCell>
                <TableCell align="center" sx={{ minWidth: 200, maxWidth: 260 }}>
                  {plot.flag ? (
                    <Tooltip
                      placement="top"
                      title={(plot.flags || [plot.flag]).map((flag) => (
                        <div key={flag}>
                          {FLAG_LABELS[flag] || flag}: {flagEvidence(plot, flag)}
                        </div>
                      ))}
                    >
                      <Stack sx={{ alignItems: 'center', minWidth: 0 }}>
                        <Typography variant="caption" color="warning.main" sx={{ lineHeight: 1.35 }}>
                          {FLAG_LABELS[plot.flag] || plot.flagLabel || plot.flag}
                          {others.length > 0 && ` +${others.length}`}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" noWrap sx={{ maxWidth: '100%' }}>
                          {flagEvidence(plot, plot.flag)}
                        </Typography>
                      </Stack>
                    </Tooltip>
                  ) : (
                    <Typography variant="caption" color="text.disabled">
                      —
                    </Typography>
                  )}
                </TableCell>
                <TableCell align="center">
                  <QcChip qc={plot.qc} edited={plot.decision?.edited} audit={plot.audit} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

PlotReviewTable.propTypes = {
  plots: PropTypes.array.isRequired,
  previous: PropTypes.instanceOf(Map),
  previousDate: PropTypes.string,
  typicalChange: PropTypes.number,
  hasRep: PropTypes.bool,
  onOpen: PropTypes.func,
  emptyText: PropTypes.string
};
