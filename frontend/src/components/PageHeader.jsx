import PropTypes from 'prop-types';
import { Link as RouterLink } from 'react-router-dom';

// material-ui
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Breadcrumbs from '@mui/material/Breadcrumbs';
import Link from '@mui/material/Link';

// assets
import RightOutlined from '@ant-design/icons/RightOutlined';

// ==============================|| PAGE HEADER ||============================== //

/**
 * Breadcrumb + title + actions for pages whose position in the hierarchy is
 * dynamic (a trial name, a page within a trial).
 *
 * Deliberately not `components/@extended/Breadcrumbs` — that one derives the
 * trail from `menu-items`, which can only describe static routes. A trail like
 * `Croplytix / Field Trials / Guadeloupe Yam Panel 2026 / Upload imagery` has a segment
 * that only the page knows, so the page passes it in.
 */
export default function PageHeader({
  crumbs = [],
  title,
  subtitle,
  actions,
  // Both default a step up from the dashboard's h5 / caption pairing: a trial
  // name is the subject of the page, not a section label. Exposed as props so a
  // denser page can dial them back without forking the component.
  titleVariant = 'h3',
  subtitleVariant = 'body1'
}) {
  return (
    <Stack sx={{ gap: 1 }}>
      {crumbs.length > 0 && (
        <Breadcrumbs
          aria-label="breadcrumb"
          separator={<RightOutlined style={{ fontSize: '0.65rem' }} />}
          sx={{ '& .MuiBreadcrumbs-separator': { mx: 0.75, color: 'text.disabled' } }}
        >
          {crumbs.map((crumb, index) => {
            const isLast = index === crumbs.length - 1;
            if (isLast || !crumb.to) {
              return (
                <Typography key={crumb.label} variant="caption" sx={{ color: isLast ? 'text.primary' : 'text.secondary' }}>
                  {crumb.label}
                </Typography>
              );
            }
            return (
              <Link
                key={crumb.label}
                component={RouterLink}
                to={crumb.to}
                variant="caption"
                underline="hover"
                sx={{ color: 'text.secondary', '&:hover': { color: 'primary.main' } }}
              >
                {crumb.label}
              </Link>
            );
          })}
        </Breadcrumbs>
      )}

      <Stack direction="row" sx={{ gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
        <Stack sx={{ gap: 0.5, minWidth: 0 }}>
          <Typography variant={titleVariant}>{title}</Typography>
          {subtitle && (
            <Typography variant={subtitleVariant} color="text.secondary">
              {subtitle}
            </Typography>
          )}
        </Stack>
        <Box sx={{ flex: 1 }} />
        {actions}
      </Stack>
    </Stack>
  );
}

PageHeader.propTypes = {
  crumbs: PropTypes.arrayOf(PropTypes.shape({ label: PropTypes.string, to: PropTypes.string })),
  title: PropTypes.node,
  subtitle: PropTypes.node,
  actions: PropTypes.node,
  titleVariant: PropTypes.string,
  subtitleVariant: PropTypes.string
};
