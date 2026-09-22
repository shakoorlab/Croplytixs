// assets
import { DeploymentUnitOutlined } from '@ant-design/icons';

// icons
const icons = {
  DeploymentUnitOutlined
};

// ==============================|| MENU ITEMS - MODELS ||============================== //

/**
 * Back-of-house. A separate area rather than a tab inside a trial: training
 * data is cross-trial by nature, and the people who open this (the ML
 * engineer, weekly) are not the people who open trials (the breeder, daily).
 */
const models = {
  id: 'group-models',
  title: 'Models',
  type: 'group',
  children: [
    {
      id: 'models',
      title: 'Model registry',
      type: 'item',
      url: '/models',
      icon: icons.DeploymentUnitOutlined,
      breadcrumbs: false
    }
  ]
};

export default models;
